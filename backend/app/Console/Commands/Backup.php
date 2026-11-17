<?php

namespace App\Console\Commands;

use App\Services\BackupAlreadyRunning;
use App\Services\Backups;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * Phase 9 (part B): php artisan buynest:backup [--list]
 * Backs up the database to the backups disk (see App\Services\Backups);
 * scheduled daily (routes/console.php). --list prints the backups instead.
 */
#[Signature('buynest:backup {--list : Print the backups instead of making one} {--trigger=cli : schedule or cli (recorded with the run)}')]
#[Description('Back up the database (gzipped mysqldump) to the backups disk')]
class Backup extends Command
{
    public function handle(Backups $backups): int
    {
        if ($this->option('list')) {
            $rows = array_map(fn ($b) => [$b['name'], number_format($b['size_bytes'] / 1024, 1).' KB', $b['created_at']], $backups->list());
            $rows ? $this->table(['Name', 'Size', 'Created (UTC)'], $rows) : $this->info('No backups yet.');

            return self::SUCCESS;
        }

        $trigger = $this->option('trigger') === 'schedule' ? 'schedule' : 'cli';
        try {
            $run = $backups->run($trigger);
        } catch (BackupAlreadyRunning $e) {
            $this->warn($e->getMessage());

            return self::FAILURE;
        }
        if ($run->status !== 'ok') {
            $this->error("The backup failed: {$run->error}");

            return self::FAILURE;
        }
        $this->info("Saved {$run->file_name} (".number_format($run->size_bytes / 1024, 1).' KB) on the '.config('buynest.backups.disk').' backups disk.');

        return self::SUCCESS;
    }
}
