<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Services\Couriers\Couriers;
use App\Services\PackingSlips;
use App\Services\Pricing;
use App\Services\Settings;
use App\Support\Csv;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Phase 14: courier-ready orders: packing slips as PDF (one order, or up to
 * 100 in one file) and the courier CSV (see docs/BANGLADESH.md for mapping
 * its columns to a courier's upload format). orders.view.
 */
class CourierController extends Controller
{
    public const CSV_COLUMNS = ['invoice', 'recipient_name', 'recipient_phone', 'recipient_address', 'district', 'area', 'cod_amount', 'weight_kg', 'note'];

    public function __construct(private PackingSlips $slips) {}

    /** GET /api/admin/v1/orders/{number}/packing-slip.pdf */
    public function packingSlip(string $number): Response|JsonResponse
    {
        $order = Order::where('number', strtoupper(trim($number)))->with(['items', 'deliveryZone'])->first();
        if (! $order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        return $this->slips->download(collect([$order]), "packing-slip-{$order->number}.pdf");
    }

    /** POST /api/admin/v1/orders/packing-slips { numbers: [1..100] } → one PDF, a page per order (in the order given). */
    public function packingSlips(Request $request): Response
    {
        $numbers = $this->numbers($request->validate([
            'numbers' => ['required', 'array', 'min:1', 'max:100'],
            'numbers.*' => ['required', 'string', 'max:20', 'distinct:ignore_case'],
        ], ['numbers.required' => 'Select at least one order.', 'numbers.max' => 'Select at most 100 orders at a time.'])['numbers']);

        return $this->slips->download($this->orders($numbers), 'packing-slips-'.now()->format('Y-m-d').'.pdf');
    }

    /**
     * GET /api/admin/v1/orders/export/courier.csv?numbers=BN-1,BN-2 (or the grid's filters
     * search, status, payment_status, source, delivery_zone, cod, confirmation_status).
     * UTF-8 with a byte order mark, so Excel shows Bangla.
     */
    public function courierCsv(Request $request, Settings $settings): Response
    {
        $data = $request->validate([
            'numbers' => ['nullable', 'string', 'max:3000'],
            'status' => ['nullable', Rule::in(Order::STATUSES)],
            'payment_status' => ['nullable', Rule::in(Order::PAYMENT_STATUSES)],
            'source' => ['nullable', Rule::in(Order::SOURCES)],
            'delivery_zone' => ['nullable', 'string', 'max:40'],
            'cod' => ['nullable', 'boolean'],
            'confirmation_status' => ['nullable', Rule::in(Order::CONFIRMATION_STATUSES)],
            'search' => ['nullable', 'string', 'max:100'],
        ]);
        if (filled($data['numbers'] ?? null)) {
            $orders = $this->orders($this->numbers(explode(',', $data['numbers'])));
        } else {
            $orders = Order::query()
                ->when($data['status'] ?? null, fn ($q, $v) => $q->where('status', $v))
                ->when($data['payment_status'] ?? null, fn ($q, $v) => $q->where('payment_status', $v))
                ->when($data['source'] ?? null, fn ($q, $v) => $q->where('source', $v))
                ->when($data['delivery_zone'] ?? null, fn ($q, $v) => $q->where('delivery_zone_code', $v))
                ->when(isset($data['cod']), fn ($q) => filter_var($data['cod'], FILTER_VALIDATE_BOOLEAN) ? $q->where('payment_method', 'cod') : $q->where('payment_method', '!=', 'cod'))
                ->when($data['confirmation_status'] ?? null, fn ($q, $v) => $q->where('confirmation_status', $v))
                ->when($data['search'] ?? null, fn ($q, $v) => $q->where(fn ($w) => $w->where('number', 'like', '%'.addcslashes($v, '%_\\').'%')
                    ->orWhere('email', 'like', '%'.addcslashes($v, '%_\\').'%')))
                ->with(['items.product', 'items.variant', 'deliveryZone'])->orderBy('id')->limit(5000)->get();
        }
        $defaultWeight = (int) $settings->get('default_weight_grams', 500);

        return Csv::download('courier-'.now()->format('Y-m-d').'.csv', self::CSV_COLUMNS, $orders->map(fn (Order $order) => self::row($order, $defaultWeight)), bom: true);
    }

    /** One courier CSV row. */
    public static function row(Order $order, int $defaultWeight): array
    {
        $address = $order->shipping_address ?? [];
        // Phase 18: phone, address line and weight are shared with the courier bookings (Couriers).
        $grams = Couriers::parcelGrams($order, $defaultWeight);
        $note = array_filter([
            $order->deliveryZone?->name,
            Pricing::toCents($order->advance_paid ?? 0) > 0 ? 'Advance paid '.Pricing::format(Pricing::toCents($order->advance_paid)) : null,
            $order->isCod() ? null : 'Prepaid',
        ]);

        return [
            $order->number,
            trim(($address['first_name'] ?? '').' '.($address['last_name'] ?? '')),
            // Bangladeshi couriers take the 11-digit local form (01712345678); a leading "+" would also be escaped as a formula.
            Couriers::localPhone($order->phone),
            Couriers::addressLine($address),
            $address['city'] ?? '',
            $address['area'] ?? '',
            Pricing::format($order->isCod() ? $order->codDueCents() : 0),
            number_format($grams / 1000, 2, '.', ''),
            implode('; ', $note),
        ];
    }

    /** @return list<string> upper-cased, trimmed, unique */
    private function numbers(array $numbers): array
    {
        $numbers = array_values(array_unique(array_filter(array_map(fn ($n) => strtoupper(trim((string) $n)), $numbers))));
        if ($numbers === [] || count($numbers) > 100) {
            throw ValidationException::withMessages(['numbers' => $numbers === [] ? 'Select at least one order.' : 'Select at most 100 orders at a time.']);
        }

        return $numbers;
    }

    /** The orders, in the order of $numbers; 422 naming any that don't exist. */
    private function orders(array $numbers): Collection
    {
        $orders = Order::whereIn('number', $numbers)->with(['items.product', 'items.variant', 'deliveryZone'])->get()->keyBy('number');
        $missing = array_values(array_diff($numbers, $orders->keys()->all()));
        if ($missing) {
            throw ValidationException::withMessages(['numbers' => 'Orders not found: '.implode(', ', $missing).'.']);
        }

        return collect($numbers)->map(fn ($number) => $orders[$number]);
    }
}
