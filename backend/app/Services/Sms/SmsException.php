<?php

namespace App\Services\Sms;

use RuntimeException;

/**
 * Phase 20: an SMS provider couldn't be reached or isn't set up. The message
 * is safe to show staff and to keep on the sms_messages row: never
 * credentials, never the text itself.
 */
class SmsException extends RuntimeException {}
