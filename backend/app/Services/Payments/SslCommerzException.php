<?php

namespace App\Services\Payments;

use RuntimeException;

/**
 * Phase 12: SSLCommerz couldn't be reached, or refused a request. The
 * message is safe to show to staff or shoppers (never the store password).
 * $unreachable: no usable answer at all (a retry may work).
 */
class SslCommerzException extends RuntimeException
{
    public function __construct(string $message, public readonly bool $unreachable = false)
    {
        parent::__construct($message);
    }
}
