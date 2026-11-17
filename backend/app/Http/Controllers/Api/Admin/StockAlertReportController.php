<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Services\StockAlerts;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Phase 9 (part B): Reports → Stock alerts (reports.view): products people are waiting for. */
class StockAlertReportController extends Controller
{
    /** GET /api/admin/v1/reports/stock-alerts?q&limit&skip */
    public function __invoke(Request $request, StockAlerts $alerts): JsonResponse
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'skip' => ['nullable', 'integer', 'min:0'],
        ]);
        [$items, $meta] = $alerts->report($data['q'] ?? null, (int) ($data['limit'] ?? 25), (int) ($data['skip'] ?? 0));

        return response()->json(['data' => $items, 'meta' => $meta]);
    }
}
