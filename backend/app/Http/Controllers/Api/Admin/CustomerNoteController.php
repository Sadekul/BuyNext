<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Services\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Staff notes about a customer (never shown to the customer). Notes can't be edited or deleted. */
class CustomerNoteController extends Controller
{
    /** GET /api/admin/v1/customers/{id}/notes → newest first. */
    public function index(int $id): JsonResponse
    {
        $customer = Customer::find($id);

        return $customer
            ? response()->json(['data' => $customer->notes()->with('admin')->get()->map->toApiArray()->values()])
            : response()->json(['message' => 'Customer not found.'], 404);
    }

    /** POST /api/admin/v1/customers/{id}/notes { body } → 201 */
    public function store(Request $request, int $id, Audit $audit): JsonResponse
    {
        $customer = Customer::find($id);
        if (! $customer) {
            return response()->json(['message' => 'Customer not found.'], 404);
        }
        $data = $request->validate(['body' => ['required', 'string', 'max:2000']], ['body.required' => 'Write the note first.']);

        $note = DB::transaction(function () use ($customer, $data, $request, $audit) {
            $note = $customer->notes()->create(['admin_id' => $request->user()->id, 'body' => trim($data['body'])]);
            $audit->record('customer.note_added', "Note added to customer {$customer->email}.", 'customer', $customer->id,
                ['before' => [], 'after' => ['note' => $note->body]]);

            return $note;
        });

        return response()->json(['data' => $note->load('admin')->toApiArray()], 201);
    }
}
