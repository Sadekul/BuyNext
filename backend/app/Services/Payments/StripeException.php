<?php

namespace App\Services\Payments;

use RuntimeException;

/**
 * Stripe couldn't be reached, or refused a request. The message is safe to
 * show to staff or shoppers: it never contains the secret key.
 */
class StripeException extends RuntimeException {}
