<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\Reports;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/admin/v1/reports/* ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, UTC;
 * default: the last 30 days; at most 366 days). Sales also takes
 * group_by=day|week|month; products takes limit (default 10, max 100).
 * sales.csv and products.csv are the same data as a download.
 */
class ReportController extends Controller
{
    private const MAX_DAYS = 366;

    public function __construct(private Reports $reports) {}

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

        $to = isset($data['to']) ? CarbonImmutable::parse($data['to'], 'UTC') : CarbonImmutable::today('UTC');
        $from = isset($data['from']) ? CarbonImmutable::parse($data['from'], 'UTC') : $to->subDays(29);
        if ($from > $to) {
            throw ValidationException::withMessages(['to' => 'The end date must be on or after the start date.']);
        }
        if ($from->diffInDays($to) + 1 > self::MAX_DAYS) {
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
        return array_filter(['from' => $from->toDateString(), 'to' => $to->toDateString(), 'group_by' => $groupBy]);
    }

    /**
     * A CSV download. A cell starting with = + - @ (or a tab / carriage
     * return) could run as a formula when opened in a spreadsheet ("CSV
     * injection"), so it gets a ' in front. Plain numbers such as -5.00 are
     * left alone: they can't be formulas, and a refund total must stay a number.
     */
    private function csv(string $filename, array $header, array $rows): Response
    {
        $stream = fopen('php://temp', 'r+');
        fputcsv($stream, $header, escape: '');
        foreach ($rows as $row) {
            fputcsv($stream, array_map($this->safeCell(...), $row), escape: '');
        }
        rewind($stream);
        $body = stream_get_contents($stream);
        fclose($stream);

        return response($body, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    private function safeCell(mixed $value): string
    {
        $value = (string) $value;
        if (preg_match('/^-?\d+(\.\d+)?$/', $value)) {
            return $value;
        }

        return preg_match('/^[=+\-@\t\r]/', $value) ? "'".$value : $value;
    }
}
