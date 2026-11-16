<?php

namespace App\Http\Resources;

/** A return as its customer sees it (ReturnResource without staff details). */
class CustomerReturnResource extends ReturnResource
{
    protected bool $forCustomer = true;
}
