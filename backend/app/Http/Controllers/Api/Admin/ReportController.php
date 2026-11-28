<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Shipment;
use App\Services\CashReports;
use App\Services\Reports;
use App\Services\RewardPoints;
use App\Support\Csv;
use App\Support\Currency;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/admin/v1/reports/* ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, in
 * the store time zone, phase 21; default: the last 30 days; at most 366
 * days). Sales also takes group_by=day|week|month; products takes limit
 * (default 10, max 100). sales.csv and products.csv are the same data as a
 * download. meta.timezone (phase 21) names the time zone of the dates.
 *
 * Phase 21: payments (money in), cod (cash on delivery and couriers),
 * cod/outstanding (cash still to collect) and their CSVs (with a BOM).
 */
class ReportController extends Controller
{
    private const MAX_DAYS = 366;

    public function __construct(private Reports $reports, private CashReports $cash) {}

    public function sales(Request $request): JsonResponse
    {
        [$from, $to, $groupBy] = $this->range($request);

        return response()->json(['data' => $this->reports->sales($from, $to, $groupBy), 'meta' => $this->meta($from, $to, $groupBy)]);
    }

    public function salesCsv(Request $request): Response
    {
        [$from, $to, $groupBy] = $this->range($request);
        $rows = array_map(fn ($row) => array_values($row), $this->reports->sales($from, $to, $groupBy)['series']);

        return $this->csv("sales-{$from->toDateString()}-to-{$to->toDateString()}.csv", ['period', 'orders', 'gross', 'refunds', 'net'], $rows);
    }

    public function products(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        return response()->json(['data' => $this->reports->products($from, $to, $this->limit($request)), 'meta' => $this->meta($from, $to)]);
    }

    public function productsCsv(Request $request): Response
    {
        [$from, $to] = $this->range($request);
        $rows = array_map(fn ($row) => array_values($row), $this->reports->products($from, $to, $this->limit($request)));

        return $this->csv("best-sellers-{$from->toDateString()}-to-{$to->toDateString()}.csv", ['product_id', 'name', 'sku', 'units', 'revenue'], $rows);
    }

    public function customers(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        return response()->json(['data' => $this->reports->customers($from, $to), 'meta' => $this->meta($from, $to)]);
    }

    public function coupons(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        return response()->json(['data' => $this->reports->coupons($from, $to), 'meta' => $this->meta($from, $to)]);
    }

    /** Phase 11: GET /reports/wishlist?from&to&limit → most wished-for products (rows added within the dates). */
    public function wishlist(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        return response()->json(['data' => $this->reports->wishlist($from, $to, $this->limit($request)), 'meta' => $this->meta($from, $to)]);
    }

    /** Phase 11: GET /reports/rewards?from&to&group_by → points issued / spent by period, and the outstanding liability. */
    public function rewards(Request $request, RewardPoints $points): JsonResponse
    {
        [$from, $to, $groupBy] = $this->range($request);

        return response()->json(['data' => $this->reports->rewards($from, $to, $groupBy, $points), 'meta' => $this->meta($from, $to, $groupBy)]);
    }

    /** Phase 21: GET /reports/payments?from&to&group_by → money received by channel and day, and refunds. */
    public function payments(Request $request): JsonResponse
    {
        [$from, $to, $groupBy] = $this->range($request);

        return response()->json(['data' => $this->cash->payments($from, $to, $groupBy), 'meta' => $this->meta($from, $to, $groupBy)]);
    }

    /** Phase 21: the payments series as a download (one row per period). */
    public function paymentsCsv(Request $request): Response
    {
        [$from, $to, $groupBy] = $this->range($request);
        $rows = array_map(fn ($row) => array_values($row), $this->cash->payments($from, $to, $groupBy)['series']);

        return Csv::download("money-in-{$from->toDateString()}-to-{$to->toDateString()}.csv",
            ['period', 'online', 'cod_cash', 'other', 'refunds', 'net_received'], $rows, bom: true);
    }

    /** Phase 21: GET /reports/cod?from&to → per courier in the range, all-time balances, what is still to collect, staff cash. */
    public function cod(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        return response()->json(['data' => $this->cash->cod($from, $to), 'meta' => $this->meta($from, $to)]);
    }

    /** Phase 21: one row per courier balance (all time). */
    public function codCsv(): Response
    {
        $rows = array_map(fn (array $row) => [$row['carrier'], $row['label'], $row['collected_all_time'], $row['fees_all_time'] ?? 'Not reported',
            $row['payouts_all_time'], $row['owed'], $row['last_payout_on'] ?? '', $row['note'] ?? ''], $this->cash->balances());

        return Csv::download('courier-balances-'.$this->reports->today()->toDateString().'.csv',
            ['carrier', 'courier', 'collected', 'fees', 'paid_to_you', 'owed', 'last_payout_on', 'note'], $rows, bom: true);
    }

    /** Phase 21: GET /reports/cod/outstanding?carrier&older_than_days&page&per_page → COD orders still to collect, oldest first. */
    public function codOutstanding(Request $request): JsonResponse
    {
        $data = $this->outstandingFilters($request);
        $page = $this->cash->outstanding($data['carrier'] ?? null, isset($data['older_than_days']) ? (int) $data['older_than_days'] : null,
            (int) ($data['per_page'] ?? 20));

        return JsonResource::collection($page)->additional(['meta' => ['currency' => Currency::store(), 'timezone' => $this->reports->timezone()]])
            ->response();
    }

    /** Phase 21: every row of the outstanding list (same filters) as a download. */
    public function codOutstandingCsv(Request $request): Response
    {
        $data = $this->outstandingFilters($request);
        $rows = array_map(fn (array $row) => array_values($row),
            $this->cash->outstandingAll($data['carrier'] ?? null, isset($data['older_than_days']) ? (int) $data['older_than_days'] : null));

        return Csv::download('cod-to-collect-'.$this->reports->today()->toDateString().'.csv',
            ['number', 'placed_at', 'shipped_at', 'carrier', 'consignment_id', 'delivery_status', 'cod_due', 'days_since_shipped'], $rows, bom: true);
    }

    private function outstandingFilters(Request $request): array
    {
        return $request->validate([
            'carrier' => ['nullable', Rule::in(array_keys(Shipment::CARRIERS))],
            'older_than_days' => ['nullable', 'integer', 'min:0', 'max:3650'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ], [
            'carrier.in' => 'Choose a courier from the list.',
            'older_than_days.*' => 'Enter a number of days (0 or more).',
        ]);
    }

    /** Not limited to dates: what is low right now. */
    public function lowStock(): JsonResponse
    {
        return response()->json(['data' => $this->reports->lowStock(), 'meta' => ['low_stock_threshold' => $this->reports->lowStockThreshold()]]);
    }

    /** [from, to, group_by] from the query, with the defaults and limits. */
    private function range(Request $request): array
    {
        $data = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'group_by' => ['nullable', 'in:day,week,month'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ], [
            'from.date_format' => 'Enter the start date as YYYY-MM-DD.',
            'to.date_format' => 'Enter the end date as YYYY-MM-DD.',
            'group_by.in' => 'Group by day, week, or month.',
        ]);

        // Phase 21: days in the store time zone (today is the store's today).
        $to = isset($data['to']) ? $this->reports->day($data['to']) : $this->reports->today();
        $from = isset($data['from']) ? $this->reports->day($data['from']) : $to->subDays(29);
        if ($from > $to) {
            throw ValidationException::withMessages(['to' => 'The end date must be on or after the start date.']);
        }
        // Counted on plain dates, so a daylight-saving change in the store time zone doesn't make a day shorter.
        if (CarbonImmutable::parse($from->toDateString(), 'UTC')->diffInDays(CarbonImmutable::parse($to->toDateString(), 'UTC')) + 1 > self::MAX_DAYS) {
            throw ValidationException::withMessages(['to' => 'A report can cover at most '.self::MAX_DAYS.' days.']);
        }

        return [$from, $to, $data['group_by'] ?? 'day'];
    }

    private function limit(Request $request): int
    {
        return (int) ($request->query('limit') ?: 10);
    }

    private function meta(CarbonImmutable $from, CarbonImmutable $to, ?string $groupBy = null): array
    {
        // Phase 12: currency = what the money in the answer is in (the store currency).
        // Phase 21: timezone = the time zone of the dates.
        return array_filter(['from' => $from->toDateString(), 'to' => $to->toDateString(), 'group_by' => $groupBy, 'currency' => Currency::store(),
            'timezone' => $this->reports->timezone()]);
    }

    private function csv(string $filename, array $header, array $rows): Response
    {
        return Csv::download($filename, $header, $rows);
    }
}
