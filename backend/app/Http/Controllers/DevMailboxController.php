<?php

namespace App\Http\Controllers;

use App\Models\DevMail;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * The local test inbox: every email the app sent, readable in the browser at
 * /dev/mailbox. Routes exist only when APP_ENV=local and DEV_MAILBOX=true.
 */
class DevMailboxController extends Controller
{
    public function index(): View
    {
        return view('dev.mailbox', ['mails' => DevMail::latest('id')->limit(100)->get()]);
    }

    public function show(DevMail $mail): View
    {
        return view('dev.mail', ['mail' => $mail]);
    }

    /** GET /dev/mailbox/latest?to=… - the newest email for an address, as JSON (for automated tests). */
    public function latest(Request $request): JsonResponse
    {
        $mail = DevMail::where('to', mb_strtolower((string) $request->query('to')))->latest('id')->first();

        return $mail
            ? response()->json(['data' => $mail->only(['id', 'to', 'subject', 'text', 'created_at'])])
            : response()->json(['message' => 'No email for that address.'], 404);
    }

    public function clear(): JsonResponse
    {
        DevMail::query()->delete();

        return response()->json(['message' => 'Inbox emptied.']);
    }
}
