<?php

namespace App\Services;

use RuntimeException;

/** Phase 9 (part B): another backup holds the lock (Backups::run). Not an error worth reporting. */
class BackupAlreadyRunning extends RuntimeException {}
