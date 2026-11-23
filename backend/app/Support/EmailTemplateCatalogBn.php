<?php

namespace App\Support;

/**
 * Phase 13: the Bangla (bn) default subject and body of every email template
 * in EmailTemplateCatalog (same keys, same variables, same allowed tags and
 * typographic quotes, so saving a default unchanged keeps it exactly).
 *
 * Polite (আপনি) Bangla as Bangladeshi online shops write it; everyday
 * loanwords (অর্ডার, কার্ট, ইনভয়েস, ডেলিভারি, কুপন) where they are what people
 * say. Codes and order numbers stay in Latin letters and digits (people type
 * them). No digits are written here: amounts and counts come from variables
 * and follow the store's bangla_digits setting.
 */
final class EmailTemplateCatalogBn
{
    private const QUESTIONS = '<p>কোনো প্রশ্ন আছে? এই ইমেইলের উত্তর দিন এবং {{ order_number }} উল্লেখ করুন।</p>';

    private const CODE = '<p>আপনার কোড:</p><blockquote><h3>{{ code }}</h3></blockquote>';

    private const IGNORE = '<p>আপনি এটি চাননি? তাহলে এই ইমেইলটি উপেক্ষা করুন। কোডটি কাউকে জানাবেন না: {{ store_name }}-এর কর্মীরা কখনো এটি চাইবেন না।</p>';

    /** key => [subject, body] */
    public static function templates(): array
    {
        return [
            'email_verification' => [
                'subject' => '{{ store_name }}-এ আপনার ইমেইল নিশ্চিত করুন',
                'body' => '<h2>আপনার ইমেইল নিশ্চিত করুন</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>{{ store_name }}-এ আপনাকে স্বাগতম! অ্যাকাউন্ট খোলা শেষ করতে নিচের কোডটি দিন।</p>'
                    .self::CODE
                    .'<p>কোডটির মেয়াদ {{ expires_minutes }} মিনিট, এবং এটি একবারই ব্যবহার করা যাবে।</p>'
                    .self::IGNORE,
            ],
            'password_reset' => [
                'subject' => 'আপনার {{ store_name }} পাসওয়ার্ড রিসেট করুন',
                'body' => '<h2>পাসওয়ার্ড রিসেট করুন</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>আপনার {{ store_name }} অ্যাকাউন্টের নতুন পাসওয়ার্ড বেছে নিতে এই কোডটি ব্যবহার করুন।</p>'
                    .self::CODE
                    .'<p>কোডটির মেয়াদ {{ expires_minutes }} মিনিট, এবং এটি একবারই ব্যবহার করা যাবে।</p>'
                    .self::IGNORE,
            ],
            'set_password' => [
                'subject' => 'আপনার {{ store_name }} পাসওয়ার্ড সেট করুন',
                'body' => '<h2>আপনার পাসওয়ার্ড সেট করুন</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>{{ store_name }}-এর কর্মীরা আপনার জন্য একটি অ্যাকাউন্ট খুলেছেন (অথবা পাসওয়ার্ড রিসেটের অনুরোধ পাঠিয়েছেন)। পাসওয়ার্ড বেছে নিতে এই কোডটি ব্যবহার করুন: '
                    .'{{ store_name }}-এর সাইন ইন পেজে “পাসওয়ার্ড ভুলে গেছেন?” বেছে নিন এবং এই ইমেইল ঠিকানাটি দিন। আমরা আরেকটি কোড পাঠালে সবচেয়ে নতুনটি ব্যবহার করুন।</p>'
                    .self::CODE
                    .'<p>কোডটির মেয়াদ {{ expires_minutes }} মিনিট, এবং এটি একবারই ব্যবহার করা যাবে।</p>'
                    .'<p>কোডের মেয়াদ শেষ হয়ে গেলে নতুন কোড পেতে আবার “পাসওয়ার্ড ভুলে গেছেন?” বেছে নিন।</p>'
                    .self::IGNORE,
            ],
            'order_confirmation' => [
                'subject' => 'আপনার {{ store_name }} অর্ডার {{ order_number }}',
                'body' => '<h2>অর্ডারের জন্য ধন্যবাদ</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>আমরা আপনার অর্ডার <strong>{{ order_number }}</strong> পেয়েছি।</p>'
                    .'{{ items_table }}'
                    .'{{ reward_points_spent }}'
                    .'<p><strong>ডেলিভারির ঠিকানা</strong></p>{{ address }}'
                    .'<p><strong>ডেলিভারি</strong><br />{{ shipping_method }}: {{ delivery_estimate }}</p>'
                    .'<p><strong>পেমেন্ট: {{ payment_method }}</strong><br />{{ next_steps }}</p>'
                    .self::QUESTIONS,
            ],
            'order_status' => [
                'subject' => '{{ status_heading }} ({{ order_number }})',
                'body' => '<h2>{{ status_heading }}</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>{{ status_message }}</p>'
                    .'<blockquote>অর্ডার <strong>{{ order_number }}</strong> · ${{ order_total }}</blockquote>'
                    .'{{ note }}'
                    .self::QUESTIONS,
            ],
            'payment_not_completed' => [
                'subject' => 'অর্ডার {{ order_number }}-এর পেমেন্ট সম্পন্ন হয়নি',
                'body' => '<h2>পেমেন্ট সম্পন্ন হয়নি</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>নির্ধারিত সময়ের মধ্যে অর্ডার <strong>{{ order_number }}</strong>-এর অনলাইন পেমেন্ট আমরা পাইনি, তাই অর্ডারটি বাতিল করা হয়েছে '
                    .'এবং পণ্যগুলো আবার বিক্রির জন্য ছেড়ে দেওয়া হয়েছে। আপনার কাছ থেকে কোনো টাকা নেওয়া হয়নি।</p>'
                    .'<blockquote>অর্ডার <strong>{{ order_number }}</strong> · ${{ order_total }}</blockquote>'
                    .'<p>পণ্যগুলো এখনও চান? আবার অর্ডার করতে পারেন, আপনাকে স্বাগতম।</p>'
                    .'{{ button }}'
                    .self::QUESTIONS,
            ],
            'email_change_code' => [
                'subject' => '{{ store_name }}-এর জন্য আপনার নতুন ইমেইল নিশ্চিত করুন',
                'body' => '<h2>আপনার নতুন ইমেইল নিশ্চিত করুন</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>আপনি আপনার {{ store_name }} অ্যাকাউন্টে {{ new_email }} ব্যবহার করতে চেয়েছেন। এটি নিশ্চিত করতে এই কোডটি দিন।</p>'
                    .self::CODE
                    .'<p>কোডটির মেয়াদ {{ expires_minutes }} মিনিট, এবং এটি একবারই ব্যবহার করা যাবে। কোডটি না দেওয়া পর্যন্ত আপনার অ্যাকাউন্টে বর্তমান ইমেইলই থাকবে।</p>'
                    .self::IGNORE,
            ],
            'email_changed' => [
                'subject' => 'আপনার {{ store_name }} ইমেইল পরিবর্তন করা হয়েছে',
                'body' => '<h2>আপনার ইমেইল পরিবর্তন করা হয়েছে</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>আপনার {{ store_name }} অ্যাকাউন্টের ইমেইল ঠিকানা {{ old_email }} থেকে বদলে <strong>{{ new_email }}</strong> করা হয়েছে। '
                    .'এখন থেকে নতুন ঠিকানা দিয়ে সাইন ইন করুন, ইমেইলও সেখানেই পাবেন।</p>'
                    .'<p>এটি আপনি করেননি? এখনই {{ support_email }} ঠিকানায় আমাদের সাথে যোগাযোগ করুন, আপনার অ্যাকাউন্ট ফিরে পেতে আমরা সাহায্য করব।</p>',
            ],
            'order_cancelled_by_customer' => [
                'subject' => 'আপনার অর্ডার বাতিল করা হয়েছে ({{ order_number }})',
                'body' => '<h2>আপনার অর্ডার বাতিল করা হয়েছে</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>আপনার অনুরোধ অনুযায়ী অর্ডার <strong>{{ order_number }}</strong> বাতিল করা হয়েছে। কোনো টাকা নেওয়া হয়নি, এবং পণ্যগুলো ছেড়ে দেওয়া হয়েছে।</p>'
                    .'<blockquote>অর্ডার <strong>{{ order_number }}</strong> · ${{ order_total }}</blockquote>'
                    .'{{ reason }}'
                    .'<p>মত বদলেছেন? আবার অর্ডার করতে পারেন, আপনাকে স্বাগতম।</p>'
                    .self::QUESTIONS,
            ],
            'account_deleted' => [
                'subject' => 'আপনার {{ store_name }} অ্যাকাউন্ট মুছে ফেলা হয়েছে',
                'body' => '<h2>আপনার অ্যাকাউন্ট মুছে ফেলা হয়েছে</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>আপনার অনুরোধ অনুযায়ী আপনার {{ store_name }} অ্যাকাউন্ট, সংরক্ষিত ঠিকানা ও সংরক্ষিত কার্ট মুছে ফেলা হয়েছে, এবং নিউজলেটারের তালিকা থেকে আপনাকে বাদ দেওয়া হয়েছে। '
                    .'আইন অনুযায়ী আগের অর্ডারের যে রেকর্ড রাখতে হয়, সেগুলো কোনো অ্যাকাউন্টের সাথে যুক্ত না করে রাখা হয়েছে।</p>'
                    .'<p>আমাদের সাথে কেনাকাটার জন্য ধন্যবাদ। আবার আসবেন, আপনাকে সবসময় স্বাগতম।</p>'
                    .'<p>এটি আপনি করেননি? এখনই {{ support_email }} ঠিকানায় আমাদের সাথে যোগাযোগ করুন।</p>',
            ],
            'invoice' => [
                'subject' => 'অর্ডার {{ order_number }}-এর পেমেন্ট পাওয়া গেছে',
                'body' => '<h2>পেমেন্ট পাওয়া গেছে</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>ধন্যবাদ: অর্ডার <strong>{{ order_number }}</strong>-এর পেমেন্ট আমরা পেয়েছি।</p>'
                    .'<blockquote>ইনভয়েস <strong>{{ invoice_number }}</strong> · ${{ invoice_amount }}</blockquote>'
                    .'<p>অর্ডারের বিস্তারিত পেজ থেকে ইনভয়েসটি দেখতে ও প্রিন্ট করতে পারবেন।</p>'
                    .'{{ reward_points_earned }}'
                    .'{{ note }}'
                    .self::QUESTIONS,
            ],
            'shipment' => [
                'subject' => 'আপনার অর্ডার পথে আছে ({{ order_number }})',
                'body' => '<h2>আপনার অর্ডার পথে আছে</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>সুখবর: অর্ডার <strong>{{ order_number }}</strong> আমাদের গুদাম থেকে রওনা হয়েছে।</p>'
                    .'{{ tracking }}{{ button }}{{ note }}'
                    .self::QUESTIONS,
            ],
            'credit_memo' => [
                'subject' => 'অর্ডার {{ order_number }}-এর রিফান্ড',
                'body' => '<h2>অর্ডার {{ order_number }}-এর রিফান্ড</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>অর্ডার <strong>{{ order_number }}</strong>-এর জন্য আমরা <strong>${{ refund_total }}</strong> রিফান্ড করেছি ({{ credit_memo_number }})। '
                    .'আপনি যেভাবে পেমেন্ট করেছিলেন, টাকা সেভাবেই ফেরত যাবে ({{ payment_method }})।</p>'
                    .'{{ items_table }}{{ note }}'
                    .self::QUESTIONS,
            ],
            'return_status' => [
                'subject' => '{{ status_heading }} ({{ return_number }})',
                'body' => '<h2>{{ status_heading }}</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>{{ status_message }}</p>'
                    .'<blockquote>রিটার্ন <strong>{{ return_number }}</strong> · অর্ডার {{ order_number }} · কারণ: {{ reason }}</blockquote>'
                    .'{{ items_table }}{{ resolution }}{{ note }}'
                    .'<p>কোনো প্রশ্ন আছে? এই ইমেইলের উত্তর দিন এবং {{ return_number }} উল্লেখ করুন।</p>',
            ],
            'newsletter_confirmation' => [
                'subject' => '{{ store_name }} নিউজলেটারের সাবস্ক্রিপশন নিশ্চিত করুন',
                'body' => '<h2>আর একটি ধাপ বাকি</h2>'
                    .'<p>অনুগ্রহ করে নিশ্চিত করুন যে আপনি {{ store_name }}-এর নিউজলেটার পেতে চান: নতুন পণ্য, অফার ও টিপস, সপ্তাহে প্রায় একবার।</p>'
                    .'{{ button }}'
                    .'<p>লিংকটি এক সপ্তাহ কাজ করবে। আপনি সাইন আপ করেননি? এই ইমেইলটি উপেক্ষা করুন, আমাদের কাছ থেকে আর কিছু পাবেন না।</p>',
            ],
            'abandoned_cart' => [
                'subject' => 'আপনার কার্টে কিছু পণ্য রয়ে গেছে',
                'body' => '<h2>আপনার কার্টে কিছু পণ্য রয়ে গেছে</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>আপনার কার্ট সংরক্ষিত আছে এবং আপনার অপেক্ষায় আছে। পণ্যগুলো আলাদা করে রাখা হয়নি, তাই স্টক শেষ হয়ে যেতে পারে।</p>'
                    .'{{ items_table }}'
                    .'{{ button }}'
                    .'<p>কোনো প্রশ্ন আছে? শুধু এই ইমেইলের উত্তর দিন।</p>',
            ],
            'back_in_stock' => [
                'subject' => '{{ product_name }} আবার স্টকে এসেছে',
                'body' => '<h2>আবার স্টকে এসেছে</h2>'
                    .'<p>সুখবর: <strong>{{ product_name }}</strong> {{ variant_label }} আবার {{ store_name }}-এ পাওয়া যাচ্ছে।</p>'
                    .'<p>স্টক সীমিত এবং পণ্য আলাদা করে রাখা হয় না, তাই আবারও শেষ হয়ে যেতে পারে।</p>'
                    .'{{ button }}'
                    .'<p>এই পণ্যটি নিয়ে এটিই আপনার কাছে আমাদের একমাত্র ইমেইল।</p>',
            ],
            'gift_card_received' => [
                'subject' => '{{ sender_name }} আপনাকে ${{ amount }} মূল্যের একটি {{ store_name }} গিফট কার্ড পাঠিয়েছেন',
                'body' => '<h2>আপনি একটি গিফট কার্ড পেয়েছেন</h2>'
                    .'<p>প্রিয় {{ recipient_name }},</p>'
                    .'<p>{{ sender_name }} আপনাকে {{ store_name }}-এর জন্য <strong>${{ amount }}</strong> মূল্যের একটি গিফট কার্ড পাঠিয়েছেন।</p>'
                    .'{{ message }}'
                    .'<p>আপনার গিফট কার্ড কোড:</p><blockquote><h3>{{ code }}</h3></blockquote>'
                    .'<p>ব্যবহার করতে চেকআউটে কোডটি দিন। {{ expires }} এই ইমেইলটি নিরাপদে রাখুন: কোডটি যার কাছে থাকবে, তিনিই ব্যালেন্স খরচ করতে পারবেন।</p>'
                    .'{{ button }}',
            ],
            'gift_card_purchased' => [
                'subject' => 'আপনার গিফট কার্ড {{ recipient_name }}-কে পাঠানো হয়েছে',
                'body' => '<h2>আপনার গিফট কার্ড পাঠানো হয়েছে</h2>'
                    .'<p>প্রিয় {{ customer_first_name }},</p>'
                    .'<p>আপনার <strong>${{ amount }}</strong> মূল্যের গিফট কার্ডটি (কোডের শেষে {{ last4 }}) আমরা {{ recipient_name }}-কে {{ recipient_email }} ঠিকানায় ইমেইল করেছি।</p>'
                    .'<blockquote>অর্ডার <strong>{{ order_number }}</strong></blockquote>'
                    .'<p>নিরাপত্তার জন্য কোডটি শুধু প্রাপকের ইমেইলেই আছে। ইমেইলটি না পৌঁছালে তাঁকে স্প্যাম ফোল্ডার দেখতে বলুন, অথবা এই ইমেইলের উত্তর দিন।</p>',
            ],
        ];
    }
}
