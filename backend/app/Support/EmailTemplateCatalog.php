<?php

namespace App\Support;

/**
 * Phase 7: every email the store sends, with its default subject and body,
 * the variables it may use, and the ones it must use (Magento's Marketing →
 * Email templates). Staff customize them in the admin; a saved row in
 * email_templates replaces the default subject and body, and "Reset to
 * default" deletes it.
 *
 * Variables are written {{ name }}. Kinds:
 * - text:  plain text, HTML-escaped when inserted (a name, an order number).
 * - url:   a link address (may also go inside <a href="...">), escaped too.
 * - block: prebuilt HTML from code (an items table, an address, a button),
 *          inserted as it is; only allowed in the body.
 *
 * The defaults use only the tags the sanitizer allows (h2, h3, p, strong,
 * a, blockquote, ...), typographic quotes (’ “ ”: the sanitizer writes
 * ' and " as entities) and <br />, so saving a default unchanged keeps it
 * exactly.
 * The store frame around the body (logo, card, footer) is the view
 * emails/layout.blade.php.
 */
final class EmailTemplateCatalog
{
    /** Variables every template may use. */
    public const COMMON = [
        'store_name' => ['Store name', 'text'],
        'support_email' => ['Support email', 'text'],
    ];

    private const CODE_VARIABLES = [
        'customer_first_name' => ['Customer first name', 'text'],
        'code' => ['The 6-digit code', 'text'],
        'expires_minutes' => ['Minutes until the code expires', 'text'],
    ];

    private const QUESTIONS = '<p>Questions? Reply to this email and mention {{ order_number }}.</p>';

    public static function keys(): array
    {
        return array_keys(self::definitions());
    }

    public static function exists(string $key): bool
    {
        return array_key_exists($key, self::definitions());
    }

    /** One template: name, description, variables ([name => [label, kind]]), required ([[any of these], ...]), subject, body. */
    public static function get(string $key): array
    {
        $definition = self::definitions()[$key];
        $definition['variables'] = [...$definition['variables'], ...self::COMMON];

        return $definition;
    }

    public static function definitions(): array
    {
        return [
            'email_verification' => [
                'name' => 'Email verification code',
                'description' => 'Sent after sign-up (and when a customer asks for a new code) to confirm the email address.',
                'variables' => self::CODE_VARIABLES,
                'required' => [['code']],
                'subject' => 'Confirm your email for {{ store_name }}',
                'body' => '<h2>Confirm your email</h2>'
                    .'<p>Hi {{ customer_first_name }},</p>'
                    .'<p>Welcome to {{ store_name }}! Enter this code to finish creating your account.</p>'
                    .'<p>Your code:</p><blockquote><h3>{{ code }}</h3></blockquote>'
                    .'<p>The code expires in {{ expires_minutes }} minutes and works once.</p>'
                    .'<p>Didn’t ask for this? You can ignore this email. Never share this code: {{ store_name }} staff will never ask for it.</p>',
            ],
            'password_reset' => [
                'name' => 'Password reset code',
                'description' => 'Sent when a customer chooses "Forgot password?".',
                'variables' => self::CODE_VARIABLES,
                'required' => [['code']],
                'subject' => 'Reset your {{ store_name }} password',
                'body' => '<h2>Reset your password</h2>'
                    .'<p>Hi {{ customer_first_name }},</p>'
                    .'<p>Use this code to choose a new password for your {{ store_name }} account.</p>'
                    .'<p>Your code:</p><blockquote><h3>{{ code }}</h3></blockquote>'
                    .'<p>The code expires in {{ expires_minutes }} minutes and works once.</p>'
                    .'<p>Didn’t ask for this? You can ignore this email. Never share this code: {{ store_name }} staff will never ask for it.</p>',
            ],
            'set_password' => [
                'name' => 'Set your password',
                'description' => 'Sent when staff create a customer account or send a password reset from the admin.',
                'variables' => self::CODE_VARIABLES,
                'required' => [['code']],
                'subject' => 'Set your {{ store_name }} password',
                'body' => '<h2>Set your password</h2>'
                    .'<p>Hi {{ customer_first_name }},</p>'
                    .'<p>{{ store_name }} staff set up your account (or a password reset) for you. Use this code to choose your password: '
                    .'on the {{ store_name }} sign-in page choose “Forgot password?” and enter this email address. If we send you another code, use the newest one.</p>'
                    .'<p>Your code:</p><blockquote><h3>{{ code }}</h3></blockquote>'
                    .'<p>The code expires in {{ expires_minutes }} minutes and works once.</p>'
                    .'<p>If the code has expired, choose “Forgot password?” again to get a new one.</p>'
                    .'<p>Didn’t ask for this? You can ignore this email. Never share this code: {{ store_name }} staff will never ask for it.</p>',
            ],
            'order_confirmation' => [
                'name' => 'Order confirmation',
                'description' => 'Sent when an order is placed (in the store, or by staff unless they turn it off).',
                'variables' => [
                    'customer_first_name' => ['Customer first name', 'text'],
                    'order_number' => ['Order number', 'text'],
                    'order_total' => ['Order total ($)', 'text'],
                    'payment_method' => ['Payment method', 'text'],
                    'shipping_method' => ['Shipping method', 'text'],
                    'delivery_estimate' => ['Delivery estimate', 'text'],
                    'next_steps' => ['What happens next (depends on the payment method)', 'text'],
                    'items_table' => ['Items and totals table', 'block'],
                    'address' => ['Shipping address', 'block'],
                ],
                'required' => [['order_number']],
                'subject' => 'Your {{ store_name }} order {{ order_number }}',
                'body' => '<h2>Thanks for your order</h2>'
                    .'<p>Hi {{ customer_first_name }},</p>'
                    .'<p>We received your order <strong>{{ order_number }}</strong>.</p>'
                    .'{{ items_table }}'
                    .'<p><strong>Shipping to</strong></p>{{ address }}'
                    .'<p><strong>Delivery</strong><br />{{ shipping_method }}: {{ delivery_estimate }}</p>'
                    .'<p><strong>Payment: {{ payment_method }}</strong><br />{{ next_steps }}</p>'
                    .self::QUESTIONS,
            ],
            'order_status' => [
                'name' => 'Order status update',
                'description' => 'Sent when staff mark an order shipped, delivered, or cancelled and choose to notify the customer.',
                'variables' => [
                    'customer_first_name' => ['Customer first name', 'text'],
                    'order_number' => ['Order number', 'text'],
                    'order_total' => ['Order total ($)', 'text'],
                    'status' => ['New status (shipped, delivered, cancelled)', 'text'],
                    'status_heading' => ['Heading for the status ("Your order is on its way")', 'text'],
                    'status_message' => ['Sentence for the status', 'text'],
                    'note' => ['Staff note ("A note from …"), empty without one', 'block'],
                ],
                'required' => [['order_number']],
                'subject' => '{{ status_heading }} ({{ order_number }})',
                'body' => '<h2>{{ status_heading }}</h2>'
                    .'<p>Hi {{ customer_first_name }},</p>'
                    .'<p>{{ status_message }}</p>'
                    .'<blockquote>Order <strong>{{ order_number }}</strong> · ${{ order_total }}</blockquote>'
                    .'{{ note }}'
                    .self::QUESTIONS,
            ],
            'payment_not_completed' => [
                'name' => 'Payment not completed',
                'description' => 'Sent when a card order is cancelled because the secure payment page (Stripe) expired before it was paid.',
                'variables' => [
                    'customer_first_name' => ['Customer first name', 'text'],
                    'order_number' => ['Order number', 'text'],
                    'order_total' => ['Order total ($)', 'text'],
                    'shop_url' => ['Link to the store', 'url'],
                    'button' => ['"Shop again" button', 'block'],
                ],
                'required' => [['order_number']],
                'subject' => 'Payment not completed for order {{ order_number }}',
                'body' => '<h2>Payment not completed</h2>'
                    .'<p>Hi {{ customer_first_name }},</p>'
                    .'<p>We didn’t receive the card payment for order <strong>{{ order_number }}</strong> in time, so the order was cancelled '
                    .'and the items were released. Nothing was charged to your card.</p>'
                    .'<blockquote>Order <strong>{{ order_number }}</strong> · ${{ order_total }}</blockquote>'
                    .'<p>Still want these items? You’re welcome to place the order again.</p>'
                    .'{{ button }}'
                    .self::QUESTIONS,
            ],
            'invoice' => [
                'name' => 'Invoice (payment received)',
                'description' => 'Sent when staff invoice an order (record the payment) and choose to notify the customer.',
                'variables' => [
                    'customer_first_name' => ['Customer first name', 'text'],
                    'order_number' => ['Order number', 'text'],
                    'invoice_number' => ['Invoice number', 'text'],
                    'invoice_amount' => ['Invoice amount ($)', 'text'],
                    'note' => ['Staff note, empty without one', 'block'],
                ],
                'required' => [['order_number']],
                'subject' => 'Payment received for order {{ order_number }}',
                'body' => '<h2>Payment received</h2>'
                    .'<p>Hi {{ customer_first_name }},</p>'
                    .'<p>Thank you: we received your payment for order <strong>{{ order_number }}</strong>.</p>'
                    .'<blockquote>Invoice <strong>{{ invoice_number }}</strong> · ${{ invoice_amount }}</blockquote>'
                    .'<p>You can view and print the invoice from your order details.</p>'
                    .'{{ note }}'
                    .self::QUESTIONS,
            ],
            'shipment' => [
                'name' => 'Shipment',
                'description' => 'Sent when staff create a shipment and choose to notify the customer.',
                'variables' => [
                    'customer_first_name' => ['Customer first name', 'text'],
                    'order_number' => ['Order number', 'text'],
                    'carrier' => ['Carrier', 'text'],
                    'tracking_number' => ['Tracking number (may be empty)', 'text'],
                    'tracking_url' => ['Carrier tracking link (may be empty)', 'url'],
                    'tracking' => ['Carrier and tracking number box', 'block'],
                    'button' => ['"Track your parcel" button, empty without a tracking link', 'block'],
                    'note' => ['Staff note, empty without one', 'block'],
                ],
                'required' => [['order_number']],
                'subject' => 'Your order is on its way ({{ order_number }})',
                'body' => '<h2>Your order is on its way</h2>'
                    .'<p>Hi {{ customer_first_name }},</p>'
                    .'<p>Good news: order <strong>{{ order_number }}</strong> has left our warehouse.</p>'
                    .'{{ tracking }}{{ button }}{{ note }}'
                    .self::QUESTIONS,
            ],
            'credit_memo' => [
                'name' => 'Credit memo (refund)',
                'description' => 'Sent when staff refund an order (credit memo) and choose to notify the customer.',
                'variables' => [
                    'customer_first_name' => ['Customer first name', 'text'],
                    'order_number' => ['Order number', 'text'],
                    'credit_memo_number' => ['Credit memo number', 'text'],
                    'refund_total' => ['Refund total ($)', 'text'],
                    'payment_method' => ['Payment method', 'text'],
                    'items_table' => ['Refunded items, shipping, adjustment, and total', 'block'],
                    'note' => ['Staff note, empty without one', 'block'],
                ],
                'required' => [['order_number']],
                'subject' => 'Refund for order {{ order_number }}',
                'body' => '<h2>Refund for order {{ order_number }}</h2>'
                    .'<p>Hi {{ customer_first_name }},</p>'
                    .'<p>We have refunded <strong>${{ refund_total }}</strong> for order <strong>{{ order_number }}</strong> ({{ credit_memo_number }}). '
                    .'The money goes back by the way you paid ({{ payment_method }}).</p>'
                    .'{{ items_table }}{{ note }}'
                    .self::QUESTIONS,
            ],
            'return_status' => [
                'name' => 'Return status',
                'description' => 'Sent when a return is requested and whenever its status changes (if staff notify the customer).',
                'variables' => [
                    'customer_first_name' => ['Customer first name', 'text'],
                    'return_number' => ['Return number (RMA-…)', 'text'],
                    'order_number' => ['Order number', 'text'],
                    'reason' => ['Return reason', 'text'],
                    'status' => ['Return status (requested, approved, …)', 'text'],
                    'status_heading' => ['Heading for the status ("Your return was approved")', 'text'],
                    'status_message' => ['Sentence for the status', 'text'],
                    'items_table' => ['Returned items', 'block'],
                    'resolution' => ['"We\'ll send you a replacement", empty otherwise', 'block'],
                    'note' => ['Staff note, empty without one', 'block'],
                ],
                'required' => [['return_number']],
                'subject' => '{{ status_heading }} ({{ return_number }})',
                'body' => '<h2>{{ status_heading }}</h2>'
                    .'<p>Hi {{ customer_first_name }},</p>'
                    .'<p>{{ status_message }}</p>'
                    .'<blockquote>Return <strong>{{ return_number }}</strong> · order {{ order_number }} · reason: {{ reason }}</blockquote>'
                    .'{{ items_table }}{{ resolution }}{{ note }}'
                    .'<p>Questions? Reply to this email and mention {{ return_number }}.</p>',
            ],
            'newsletter_confirmation' => [
                'name' => 'Newsletter confirmation',
                'description' => 'Sent when someone subscribes to the newsletter, with the link that confirms the subscription.',
                'variables' => [
                    'confirm_url' => ['Confirmation link', 'url'],
                    'button' => ['"Confirm subscription" button', 'block'],
                ],
                'required' => [['button', 'confirm_url']],
                'subject' => 'Confirm your {{ store_name }} newsletter subscription',
                'body' => '<h2>One more step</h2>'
                    .'<p>Please confirm that you want the {{ store_name }} newsletter: new arrivals, deals, and tips, about once a week.</p>'
                    .'{{ button }}'
                    .'<p>The link works for 7 days. Didn’t sign up? Ignore this email and you won’t hear from us.</p>',
            ],
            'abandoned_cart' => [
                'name' => 'Abandoned cart reminder',
                'description' => 'Sent when staff remind a customer about the items left in their cart (Reports → Abandoned carts).',
                'variables' => [
                    'customer_first_name' => ['Customer first name', 'text'],
                    'cart_subtotal' => ['Cart subtotal ($)', 'text'],
                    'cart_url' => ['Link to the cart', 'url'],
                    'items_table' => ['Items in the cart', 'block'],
                    'button' => ['"Back to your cart" button', 'block'],
                ],
                'required' => [['button', 'cart_url']],
                'subject' => 'You left something in your cart',
                'body' => '<h2>You left something in your cart</h2>'
                    .'<p>Hi {{ customer_first_name }},</p>'
                    .'<p>Your cart is saved and waiting for you. Items aren’t reserved, so they may sell out.</p>'
                    .'{{ items_table }}'
                    .'{{ button }}'
                    .'<p>Questions? Just reply to this email.</p>',
            ],
        ];
    }

    /** Sample values for the admin preview and test email (blocks built by EmailBlocks). */
    public static function sample(string $key): array
    {
        $items = [['Wireless Headphones', 1, '79.99'], ['Cotton Tee (Size: M / Color: Navy)', 2, '39.98']];
        $address = ['first_name' => 'Ava', 'last_name' => 'Customer', 'line1' => '12 Market Street', 'line2' => null,
            'city' => 'Springfield', 'state' => 'Oregon', 'postal_code' => '29112', 'country' => 'United States'];
        $note = EmailBlocks::note('Thanks for shopping with us!');

        $values = match ($key) {
            'email_verification', 'password_reset', 'set_password' => [
                'customer_first_name' => 'Ava', 'code' => '123456', 'expires_minutes' => '10',
            ],
            'order_confirmation' => [
                'customer_first_name' => 'Ava', 'order_number' => 'BN-100001', 'order_total' => '124.96',
                'payment_method' => 'Cash on delivery', 'shipping_method' => 'Standard', 'delivery_estimate' => '3–5 business days',
                'next_steps' => 'We are preparing your order now. Please pay the courier in cash when it arrives.',
                'items_table' => EmailBlocks::itemsTable(
                    array_map(fn ($i) => ["{$i[0]} × {$i[1]}", '$'.$i[2]], $items),
                    [['Subtotal', '$119.97'], ['Shipping (Standard)', '$4.99'], ['Tax', '$0.00'], ['Total', '$124.96', true]],
                ),
                'address' => EmailBlocks::address($address),
            ],
            'order_status' => [
                'customer_first_name' => 'Ava', 'order_number' => 'BN-100001', 'order_total' => '124.96', 'status' => 'shipped',
                'status_heading' => 'Your order is on its way', 'status_message' => 'Good news: your order has left our warehouse.',
                'note' => $note,
            ],
            'payment_not_completed' => [
                'customer_first_name' => 'Ava', 'order_number' => 'BN-100001', 'order_total' => '124.96',
                'shop_url' => config('buynest.storefront_url'),
                'button' => EmailBlocks::button(config('buynest.storefront_url'), 'Shop again'),
            ],
            'invoice' => [
                'customer_first_name' => 'Ava', 'order_number' => 'BN-100001', 'invoice_number' => 'INV-100001',
                'invoice_amount' => '124.96', 'note' => $note,
            ],
            'shipment' => [
                'customer_first_name' => 'Ava', 'order_number' => 'BN-100001', 'carrier' => 'UPS', 'tracking_number' => '1Z999AA10123456784',
                'tracking_url' => 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
                'tracking' => EmailBlocks::tracking('UPS', '1Z999AA10123456784'),
                'button' => EmailBlocks::button('https://www.ups.com/track?tracknum=1Z999AA10123456784', 'Track your parcel'),
                'note' => $note,
            ],
            'credit_memo' => [
                'customer_first_name' => 'Ava', 'order_number' => 'BN-100001', 'credit_memo_number' => 'CM-100001',
                'refund_total' => '84.98', 'payment_method' => 'Cash on delivery',
                'items_table' => EmailBlocks::itemsTable([['Wireless Headphones × 1', '$79.99'], ['Shipping', '$4.99']], [['Refund total', '$84.98', true]]),
                'note' => $note,
            ],
            'return_status' => [
                'customer_first_name' => 'Ava', 'return_number' => 'RMA-100001', 'order_number' => 'BN-100001', 'reason' => 'Damaged',
                'status' => 'approved', 'status_heading' => 'Your return was approved',
                'status_message' => 'Your return was approved. Please pack the items securely and send them back to us, with the return number on the parcel.',
                'items_table' => EmailBlocks::list(['Wireless Headphones × 1']),
                'resolution' => '', 'note' => $note,
            ],
            'newsletter_confirmation' => [
                'confirm_url' => config('buynest.storefront_url').'/newsletter/confirm?token=sample',
                'button' => EmailBlocks::button(config('buynest.storefront_url').'/newsletter/confirm?token=sample', 'Confirm subscription'),
            ],
            'abandoned_cart' => [
                'customer_first_name' => 'Ava', 'cart_subtotal' => '119.97', 'cart_url' => config('buynest.storefront_url').'/cart',
                'items_table' => EmailBlocks::itemsTable(array_map(fn ($i) => ["{$i[0]} × {$i[1]}", '$'.$i[2]], $items), [['Subtotal', '$119.97', true]]),
                'button' => EmailBlocks::button(config('buynest.storefront_url').'/cart', 'Back to your cart'),
            ],
        };

        return $values;
    }
}
