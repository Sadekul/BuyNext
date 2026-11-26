<?php

namespace App\Services\Couriers;

use RuntimeException;

/**
 * Phase 18: a courier refused a request or couldn't be reached. The message
 * is safe to show staff (translated, the courier's own reason at most):
 * never credentials, never the recipient's details. $unreachable: the
 * courier didn't answer (or answered with a server error) → 502 where the
 * contract says so.
 */
class CourierException extends RuntimeException
{
    public function __construct(string $message, public readonly bool $unreachable = false)
    {
        parent::__construct($message);
    }
}
