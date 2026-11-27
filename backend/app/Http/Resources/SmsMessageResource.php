<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Phase 20: one text in the admin (SMS log, test send, retry). The full number:
 * only staff with orders.view (or settings.edit, for their own test send) see it.
 */
class SmsMessageResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'order' => $this->order_id && $this->order ? ['number' => $this->order->number] : null,
            'event' => $this->event,
            'to' => $this->to,
            'body' => $this->body,
            'locale' => $this->locale,
            'segments' => $this->segments,
            'encoding' => $this->encoding,
            'provider' => $this->provider,
            'status' => $this->status,
            'error' => $this->error,
            'attempts' => $this->attempts,
            'sent_at' => $this->sent_at?->toIso8601ZuluString(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
