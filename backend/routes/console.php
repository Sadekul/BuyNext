<?php

use Illuminate\Support\Facades\Schedule;

// Deletes sign-ups that never confirmed their email (Customer::prunable).
Schedule::command('model:prune')->daily();
