<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\CustomerAddress;
use App\Services\AddressBook;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** The signed-in customer's address book. Another customer's address is "not found". */
class AddressController extends Controller
{
    public function __construct(private AddressBook $book) {}

    /** GET /api/v1/me/addresses → defaults first. */
    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->book->list($request->user())]);
    }

    /** POST /api/v1/me/addresses → 201 */
    public function store(Request $request): JsonResponse
    {
        $address = $this->book->create($request->user(), $this->book->validate($request, partial: false));

        return response()->json(['data' => $address->refresh()->toApiArray()], 201);
    }

    /** PATCH /api/v1/me/addresses/{id} */
    public function update(Request $request, int $id): JsonResponse
    {
        $address = $this->find($request, $id);
        if (! $address) {
            return $this->notFound();
        }
        $address = $this->book->update($address, $this->book->validate($request, partial: true, existing: $address));

        return response()->json(['data' => $address->refresh()->toApiArray()]);
    }

    /** DELETE /api/v1/me/addresses/{id} → 204 */
    public function destroy(Request $request, int $id): Response|JsonResponse
    {
        $address = $this->find($request, $id);
        if (! $address) {
            return $this->notFound();
        }
        $this->book->delete($address);

        return response()->noContent();
    }

    private function find(Request $request, int $id): ?CustomerAddress
    {
        return CustomerAddress::where('customer_id', $request->user()->id)->find($id);
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['message' => __('Address not found.')], 404);
    }
}
