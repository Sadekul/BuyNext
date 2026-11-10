<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\JsonResponse;

class CategoryController extends Controller
{
    /** GET /api/admin/v1/categories - every category, with how many (not deleted) products it has. */
    public function index(): JsonResponse
    {
        $categories = Category::withCount('products')->orderBy('position')->orderBy('name')->get()
            ->map(fn (Category $category) => [
                'id' => $category->id,
                'slug' => $category->slug,
                'name' => $category->name,
                'product_count' => $category->products_count,
            ]);

        return response()->json(['data' => $categories]);
    }
}
