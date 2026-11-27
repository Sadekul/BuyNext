<?php

namespace App\Http\Controllers;

use App\Models\SmsMessage;
use App\Services\Sms\Sms;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * Phase 20: the dev SMS inbox, like the test inbox for emails: every text
 * the app wrote (any provider; with the log driver nothing leaves the
 * server), readable at /dev/sms. Routes exist only when APP_ENV is local or
 * testing, and every action checks again (a cached route list can't open it
 * in production).
 */
class DevSmsController extends Controller
{
    public function index(): View
    {
        $this->guard();

        return view('dev.sms', ['messages' => SmsMessage::with('order:id,number')->latest('id')->limit(100)->get()]);
    }

    /** GET /dev/sms/latest?to=01712345678 → the newest text to that number, as JSON (for the browser suite). */
    public function latest(Request $request): JsonResponse
    {
        $this->guard();
        $to = Sms::mobile((string) $request->query('to'));
        $message = $to ? SmsMessage::with('order:id,number')->where('to', $to)->latest('id')->first() : null;

        return $message
            ? response()->json(['data' => [
                ...$message->only(['id', 'to', 'event', 'body', 'locale', 'segments', 'encoding', 'provider', 'status', 'error']),
                'order_number' => $message->order?->number,
                'created_at' => $message->created_at?->toIso8601ZuluString(),
            ]])
            : response()->json(['message' => 'No text for that number.'], 404);
    }

    private function guard(): void
    {
        abort_unless(app()->environment('local', 'testing'), 404);
    }
}
