<?php

namespace App\Services;

use App\Models\Admin;
use App\Models\BackupRun;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Throwable;

/**
 * Phase 9 (part B): database backups.
 *
 * run(): mysqldump --single-transaction (a consistent snapshot without
 * locking the shop) into a temporary file, gzipped, then saved on the
 * "backups" disk (config/filesystems.php: a local folder or an S3 bucket) as
 * buynest-YYYYMMDD-HHMMSS.sql.gz (UTC). Older backups than BACKUP_KEEP_DAYS
 * are then deleted (never the newest). Every attempt is a backup_runs row.
 *
 * The database password is never on a command line (where any user of the
 * machine could read it with `ps`): mysqldump reads it from a temporary
 * "defaults file" that only this process can read (0600), deleted in a
 * `finally`, whatever happens.
 *
 * A failure is recorded, reported (Sentry), and shown to Owners as a
 * critical admin notification (backup_failed).
 */
class Backups
{
    public const NAME = '/^buynest-(\d{8})-(\d{6})\.sql\.gz$/';

    private const LOCK = 'buynest:backup';

    public function __construct(private AdminNotifications $notifications) {}

    public function disk(): Filesystem
    {
        return Storage::disk('backups');
    }

    /** Is a backup running right now (in any container)? */
    public function running(): bool
    {
        $lock = Cache::lock(self::LOCK, 10);
        if ($lock->get()) {
            $lock->release();

            return false;
        }

        return true;
    }

    /**
     * Makes a backup. $trigger: schedule | admin | cli. Returns the run (ok or
     * failed); throws BackupAlreadyRunning when another one is in progress.
     */
    public function run(string $trigger, ?Admin $admin = null): BackupRun
    {
        $lock = Cache::lock(self::LOCK, (int) config('buynest.backups.timeout_seconds') + 120);
        if (! $lock->get()) {
            throw new BackupAlreadyRunning('A backup is already running. Try again in a few minutes.');
        }

        $run = BackupRun::create(['status' => 'running', 'trigger' => $trigger, 'admin_id' => $admin?->id, 'started_at' => now()]);
        try {
            $name = 'buynest-'.now('UTC')->format('Ymd-His').'.sql.gz';
            $size = $this->dumpTo($name);
            $run->forceFill(['status' => 'ok', 'file_name' => $name, 'size_bytes' => $size, 'finished_at' => now()])->save();
            $this->prune($name);
        } catch (Throwable $e) {
            $message = mb_substr($e->getMessage(), 0, 500);
            $run->forceFill(['status' => 'failed', 'error' => $message, 'finished_at' => now()])->save();
            report($e);
            try {
                $this->notifications->notify('backup_failed', 'backup', 'Database backup failed',
                    "The {$trigger} backup at ".$run->started_at->toDateTimeString()." UTC failed: {$message}", '/system/backups');
            } catch (Throwable $notifyError) {
                report($notifyError);
            }
        } finally {
            $lock->release();
        }

        return $run->refresh();
    }

    /** [{ name, size_bytes, created_at }], newest first (only files this class names). */
    public function list(): array
    {
        $disk = $this->disk();
        $items = [];
        foreach ($disk->files() as $file) {
            if (! preg_match(self::NAME, $file)) {
                continue;
            }
            $items[] = ['name' => $file, 'size_bytes' => $disk->size($file), 'created_at' => self::createdAt($file)->toIso8601ZuluString()];
        }
        usort($items, fn ($a, $b) => strcmp($b['name'], $a['name']));

        return $items;
    }

    public function exists(string $name): bool
    {
        return preg_match(self::NAME, $name) === 1 && $this->disk()->exists($name);
    }

    /** buynest-20261117-030000.sql.gz → 2026-11-17 03:00:00 UTC */
    public static function createdAt(string $name): Carbon
    {
        preg_match(self::NAME, $name, $match);

        return Carbon::createFromFormat('YmdHis', $match[1].$match[2], 'UTC');
    }

    /** Deletes backups older than keep_days (by the time in their name), never $keep (the one just made). */
    public function prune(string $keep): int
    {
        $cutoff = now('UTC')->subDays((int) config('buynest.backups.keep_days'));
        $deleted = 0;
        foreach ($this->disk()->files() as $file) {
            if ($file !== $keep && preg_match(self::NAME, $file) && self::createdAt($file)->lt($cutoff)) {
                $this->disk()->delete($file);
                $deleted++;
            }
        }

        return $deleted;
    }

    /** Dumps the database, gzips it, saves it as $name on the backups disk. Returns the size in bytes. */
    private function dumpTo(string $name): int
    {
        $connection = config('database.connections.'.config('database.default'));
        if (! in_array($connection['driver'] ?? null, ['mysql', 'mariadb'], true)) {
            throw new RuntimeException('Backups need a MySQL or MariaDB database.');
        }

        $defaults = $this->temporaryFile('buynest-db-');
        $sql = $this->temporaryFile('buynest-dump-');
        $gz = $this->temporaryFile('buynest-gz-');
        try {
            file_put_contents($defaults, self::defaultsFile($connection));

            $result = Process::timeout((int) config('buynest.backups.timeout_seconds'))->run([
                (string) config('buynest.backups.dump_binary'),
                '--defaults-extra-file='.$defaults, // must come first; holds user, password, host, port
                '--single-transaction',
                '--quick',
                '--no-tablespaces',
                '--hex-blob',
                '--default-character-set=utf8mb4',
                '--result-file='.$sql,
                (string) $connection['database'],
            ]);
            if (! $result->successful()) {
                $error = trim($result->errorOutput()) ?: 'exit code '.$result->exitCode();
                throw new RuntimeException('mysqldump failed: '.mb_substr($error, 0, 400));
            }
            // A dump that stopped half-way has no closing line.
            if (! is_file($sql) || filesize($sql) === 0 || ! str_contains($this->tail($sql), 'Dump completed')) {
                throw new RuntimeException('mysqldump finished but the dump is empty or incomplete.');
            }

            $this->gzip($sql, $gz);
            $stream = fopen($gz, 'rb');
            try {
                $this->disk()->writeStream($name, $stream);
            } finally {
                if (is_resource($stream)) {
                    fclose($stream);
                }
            }

            return (int) filesize($gz);
        } finally {
            foreach ([$defaults, $sql, $gz] as $file) {
                if (is_file($file)) {
                    @unlink($file);
                }
            }
        }
    }

    /**
     * The [client] option file for mysqldump. Values are quoted, with \ and "
     * escaped, so any password works. [client-mariadb] holds an option only
     * MariaDB's client (the production image's mysqldump) reads: Railway's
     * MySQL is reached over the private network with its own certificate.
     */
    public static function defaultsFile(array $connection): string
    {
        $quote = fn ($value) => '"'.str_replace(['\\', '"'], ['\\\\', '\\"'], (string) $value).'"';
        $lines = ['[client]', 'user='.$quote($connection['username'] ?? ''), 'password='.$quote($connection['password'] ?? '')];
        if (! empty($connection['unix_socket'])) {
            $lines[] = 'socket='.$quote($connection['unix_socket']);
        } else {
            $lines[] = 'host='.$quote($connection['host'] ?? '127.0.0.1');
            $lines[] = 'port='.(int) ($connection['port'] ?? 3306);
        }
        $lines[] = '';
        $lines[] = '[client-mariadb]';
        $lines[] = 'disable-ssl-verify-server-cert';

        return implode("\n", $lines)."\n";
    }

    /** A new empty file only this process's user can read or write. */
    private function temporaryFile(string $prefix): string
    {
        $path = tempnam(sys_get_temp_dir(), $prefix);
        if ($path === false) {
            throw new RuntimeException('Could not create a temporary file for the backup.');
        }
        chmod($path, 0600);

        return $path;
    }

    private function gzip(string $from, string $to): void
    {
        $in = fopen($from, 'rb');
        $out = gzopen($to, 'wb6');
        if (! $in || ! $out) {
            throw new RuntimeException('Could not compress the dump.');
        }
        try {
            while (! feof($in)) {
                $chunk = fread($in, 1024 * 1024);
                if ($chunk === false || ($chunk !== '' && gzwrite($out, $chunk) === false)) {
                    throw new RuntimeException('Could not compress the dump.');
                }
            }
        } finally {
            fclose($in);
            gzclose($out);
        }
    }

    private function tail(string $file): string
    {
        $handle = fopen($file, 'rb');
        fseek($handle, max(0, filesize($file) - 512));
        $tail = (string) stream_get_contents($handle);
        fclose($handle);

        return $tail;
    }
}
