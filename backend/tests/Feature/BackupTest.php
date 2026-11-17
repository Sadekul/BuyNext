<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AdminNotification;
use App\Models\AuditLog;
use App\Models\BackupRun;
use App\Services\Backups;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 9 (part B): database backups with a faked mysqldump and a faked disk. */
class BackupTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private const DUMP = "-- MySQL dump\nCREATE TABLE `x` (id int);\n-- Dump completed on 2026-11-17 03:00:00\n";

    /** What the fake mysqldump saw: the command line and its defaults file's contents. */
    private array $seen = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('backups');
        config(['database.connections.mysql.password' => 'pa"ss\\word secret']);
    }

    /** A fake mysqldump that writes $output to its --result-file and exits with $exit. */
    private function fakeDump(string $output = self::DUMP, int $exit = 0, string $stderr = ''): void
    {
        Process::fake(function (PendingProcess $process) use ($output, $exit, $stderr) {
            $args = $process->command;
            $this->seen['command'] = $args;
            foreach ($args as $arg) {
                if (str_starts_with($arg, '--defaults-extra-file=')) {
                    $this->seen['defaults_path'] = substr($arg, 22);
                    $this->seen['defaults'] = file_get_contents($this->seen['defaults_path']);
                    $this->seen['defaults_mode'] = fileperms($this->seen['defaults_path']) & 0777;
                }
                if (str_starts_with($arg, '--result-file=')) {
                    file_put_contents(substr($arg, 14), $output);
                }
            }

            return Process::result(errorOutput: $stderr, exitCode: $exit);
        });
    }

    public function test_a_backup_is_a_gzipped_dump_with_the_password_never_on_the_command_line(): void
    {
        $this->fakeDump();
        $this->travelTo(now('UTC')->setDate(2026, 11, 17)->setTime(3, 0, 5));

        $this->artisan('buynest:backup')->expectsOutputToContain('Saved buynest-20261117-030005.sql.gz')->assertSuccessful();

        $disk = Storage::disk('backups');
        $this->assertSame(['buynest-20261117-030005.sql.gz'], $disk->files());
        $this->assertSame(self::DUMP, gzdecode($disk->get('buynest-20261117-030005.sql.gz')));

        $command = implode(' ', $this->seen['command']);
        $this->assertSame('mysqldump', $this->seen['command'][0]);
        $this->assertStringStartsWith('--defaults-extra-file=', $this->seen['command'][1]);
        $this->assertContains('--single-transaction', $this->seen['command']);
        $this->assertStringNotContainsString('secret', $command);
        $this->assertStringNotContainsString('--password', $command);
        $this->assertSame(config('database.connections.mysql.database'), last($this->seen['command']));

        // The password was in a file only this user could read, which is gone now.
        $this->assertStringContainsString('password="pa\\"ss\\\\word secret"', $this->seen['defaults']);
        $this->assertSame(0600, $this->seen['defaults_mode']);
        $this->assertFileDoesNotExist($this->seen['defaults_path']);

        $run = BackupRun::sole();
        $this->assertSame(['ok', 'cli', 'buynest-20261117-030005.sql.gz'], [$run->status, $run->trigger, $run->file_name]);
        $this->assertSame($disk->size('buynest-20261117-030005.sql.gz'), $run->size_bytes);
    }

    public function test_the_defaults_file_escapes_values(): void
    {
        $file = Backups::defaultsFile(['username' => 'shop', 'password' => 'a"b\\c', 'host' => 'db.internal', 'port' => '3307']);
        $this->assertSame("[client]\nuser=\"shop\"\npassword=\"a\\\"b\\\\c\"\nhost=\"db.internal\"\nport=3307\n\n[client-mariadb]\ndisable-ssl-verify-server-cert\n", $file);
    }

    public function test_old_backups_are_deleted_after_keep_days(): void
    {
        $this->fakeDump();
        config(['buynest.backups.keep_days' => 14]);
        $disk = Storage::disk('backups');
        $old = 'buynest-'.now('UTC')->subDays(15)->format('Ymd-His').'.sql.gz';
        $recent = 'buynest-'.now('UTC')->subDays(13)->format('Ymd-His').'.sql.gz';
        $disk->put($old, 'x');
        $disk->put($recent, 'x');
        $disk->put('notes.txt', 'not a backup: left alone');

        $this->artisan('buynest:backup')->assertSuccessful();

        $files = $disk->files();
        $this->assertNotContains($old, $files);
        $this->assertContains($recent, $files);
        $this->assertContains('notes.txt', $files);
        $this->assertCount(3, $files);

        $this->artisan('buynest:backup --list')->expectsOutputToContain($recent)->assertSuccessful();
    }

    public function test_a_failed_backup_is_recorded_and_notifies_owners(): void
    {
        $this->fakeDump('', 2, "mysqldump: Got error: 1045: Access denied for user 'shop'");

        $this->artisan('buynest:backup --trigger=schedule')->expectsOutputToContain('Access denied')->assertFailed();

        $run = BackupRun::sole();
        $this->assertSame(['failed', 'schedule'], [$run->status, $run->trigger]);
        $this->assertStringContainsString('Access denied', $run->error);
        $this->assertSame([], Storage::disk('backups')->files());
        $this->assertFileDoesNotExist($this->seen['defaults_path']);

        $notification = AdminNotification::sole();
        $this->assertSame(['backup_failed', 'critical', 'backups.view', '/system/backups'],
            [$notification->type, $notification->severity, $notification->permission, $notification->link]);
    }

    public function test_an_incomplete_dump_is_a_failure(): void
    {
        $this->fakeDump("-- MySQL dump\nCREATE TABLE `x` (");
        $this->artisan('buynest:backup')->expectsOutputToContain('incomplete')->assertFailed();
        $this->assertSame([], Storage::disk('backups')->files());
    }

    public function test_the_admin_lists_makes_and_downloads_backups(): void
    {
        $this->fakeDump();
        $owner = $this->adminHeaders();

        $this->asAdmin($owner, 'GET', '/api/admin/v1/backups')->assertOk()
            ->assertExactJson(['data' => [], 'meta' => ['disk' => 'local', 'keep_days' => 14, 'schedule' => '03:00', 'timezone' => 'UTC', 'running' => false, 'last_run' => null]]);

        $made = $this->asAdmin($owner, 'POST', '/api/admin/v1/backups')->assertCreated()->json('data');
        $this->assertSame(['id', 'status', 'trigger', 'file_name', 'size_bytes', 'error', 'started_at', 'finished_at', 'admin'], array_keys($made));
        $this->assertSame(['ok', 'admin', 'Store Admin'], [$made['status'], $made['trigger'], $made['admin']['name']]);
        $this->assertSame('backup.created', AuditLog::latest('id')->first()->action);

        $list = $this->asAdmin($owner, 'GET', '/api/admin/v1/backups')->assertOk();
        $this->assertSame([['name' => $made['file_name'], 'size_bytes' => $made['size_bytes'], 'created_at' => $list->json('data.0.created_at')]], $list->json('data'));
        $this->assertSame($made['id'], $list->json('meta.last_run.id'));

        // A signed link, valid 5 minutes, that still needs the admin's sign-in.
        $link = $this->asAdmin($owner, 'POST', "/api/admin/v1/backups/{$made['file_name']}/link")->assertOk()->json('data');
        $this->assertStringStartsWith("/api/admin/v1/backups/{$made['file_name']}/download?expires=", $link['url']);
        $this->assertStringContainsString('&signature=', $link['url']);

        $this->app['auth']->forgetGuards();
        $download = $this->get($link['url'], $owner)->assertOk();
        $this->assertSame('application/gzip', $download->headers->get('Content-Type'));
        $this->assertStringContainsString("attachment; filename={$made['file_name']}", $download->headers->get('Content-Disposition'));
        $this->assertSame(self::DUMP, gzdecode($download->streamedContent()));
        $this->assertSame('backup.downloaded', AuditLog::latest('id')->first()->action);

        $this->app['auth']->forgetGuards();
        $this->getJson($link['url'])->assertUnauthorized(); // no sign-in
        $this->app['auth']->forgetGuards();
        $this->getJson(str_replace('signature=', 'signature=0', $link['url']), $owner)->assertForbidden();
        $this->travel(6)->minutes();
        $this->app['auth']->forgetGuards();
        $this->getJson($link['url'], $owner)->assertForbidden()->assertJsonPath('message', 'This download link has expired. Create a new one.');

        $this->asAdmin($owner, 'POST', '/api/admin/v1/backups/buynest-20200101-000000.sql.gz/link')->assertNotFound();
        $this->asAdmin($owner, 'POST', '/api/admin/v1/backups/..%2F.env/link')->assertNotFound();
    }

    public function test_backups_are_owner_only_by_default(): void
    {
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/backups')->assertForbidden();
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/backups')->assertForbidden();

        // A role given the key may.
        $this->fakeDump();
        $custom = $this->signInAdmin(Admin::factory()->role(['backups.view'])->create());
        $this->asAdmin($custom, 'GET', '/api/admin/v1/backups')->assertOk();
    }

    public function test_one_backup_at_a_time(): void
    {
        $this->fakeDump();
        $lock = Cache::lock('buynest:backup', 60);
        $lock->get();

        $owner = $this->adminHeaders();
        $this->asAdmin($owner, 'GET', '/api/admin/v1/backups')->assertJsonPath('meta.running', true);
        $this->asAdmin($owner, 'POST', '/api/admin/v1/backups')->assertJsonValidationErrors(['backup' => 'A backup is already running. Try again in a few minutes.']);
        $this->artisan('buynest:backup')->assertFailed();
        $this->assertSame(0, BackupRun::count());

        $lock->release();
        $this->asAdmin($owner, 'POST', '/api/admin/v1/backups')->assertCreated();
    }

    public function test_a_failure_from_the_admin_is_a_422_with_the_reason(): void
    {
        $this->fakeDump('', 1, 'mysqldump: unknown option');
        $this->asAdmin($this->adminHeaders(), 'POST', '/api/admin/v1/backups')
            ->assertJsonValidationErrors(['backup' => 'The backup failed: mysqldump failed: mysqldump: unknown option']);
    }
}
