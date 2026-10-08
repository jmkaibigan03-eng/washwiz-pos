<?php
// add_order.php
// Saves a NEW ORDER. One order touches four tables, so everything runs inside ONE transaction:
//   customers -> orders -> order_items -> payments
// If any step fails we ROLLBACK, so there are never half-saved orders.
// Who took the order (staff_id) comes from the logged-in PHP session, never from the browser's data.
require_once 'db.php';
require_once 'auth.php';

require_post();
$user = require_login();   // stops here with a 401 error unless a staff member (Admin or Cashier) is logged in
$input = get_json_input();

// ---------- 1. Read and clean what the browser sent ----------
$customerName = clean_text($input['customer_name'] ?? '');
$phone        = clean_text($input['phone'] ?? '');
$serviceId    = (int) clean_text($input['service_id'] ?? 0);
$quantity     = is_numeric($input['quantity'] ?? null) ? round((float) $input['quantity'], 2) : 0.0;
$fulfillment  = clean_text($input['fulfillment'] ?? '');
$address      = clean_text($input['address'] ?? '');
$dueDate      = clean_text($input['due_date'] ?? '');
$notes        = clean_text($input['notes'] ?? '');
$markPaid     = (($input['paid'] ?? false) === true);

// ---------- 2. Validate on the server (the browser's checks can be skipped) ----------
if ($customerName === '' || strlen($customerName) > 100) {
    send_error('Enter the customer name (up to 100 characters).');
}
if (strlen(preg_replace('/\D/', '', $phone)) < 7 || strlen($phone) > 20) {
    send_error('Enter a phone number with at least 7 digits (up to 20 characters).');
}
if ($serviceId <= 0) {
    send_error('Choose a service.');
}
if ($quantity <= 0 || $quantity > 1000) {
    send_error('Enter a quantity greater than 0 (up to 1000).');
}
if (!in_array($fulfillment, ['Store Dropoff', 'Home Delivery'], true)) {
    send_error('Choose Store Dropoff or Home Delivery.');
}
$isDelivery = ($fulfillment === 'Home Delivery');
if ($isDelivery && $address === '') {
    send_error('Delivery address is required for home delivery.');
}
$dueDateValue = null;   // the due date is optional
if ($dueDate !== '') {
    $validDate = preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $dueDate, $m) && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    if (!$validDate) {
        send_error('The due date is not a valid date.');
    }
    $dueDateValue = $dueDate;
}
$notesValue = ($notes === '') ? null : $notes;

// ---------- 3. Calculate the money on the server ----------
// Get the real price from MySQL. We never trust a price sent by the browser.
$sql = "SELECT price FROM services WHERE service_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $serviceId);
$stmt->execute();
$service = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$service) {
    send_error('That service no longer exists. Please refresh the page.', 404);
}

$subtotal    = round((float) $service['price'] * $quantity, 2);   // price x quantity
$deliveryFee = $isDelivery ? DEFAULT_DELIVERY_FEE : 0.00;         // the fee only applies to Home Delivery
$total       = round($subtotal + $deliveryFee, 2);
$today       = date('Y-m-d');
$isPaid      = $markPaid ? 1 : 0;
$amountPaid  = $markPaid ? $total : 0.00;    // a paid order stores its full total, an unpaid one stores 0
$paymentDate = $markPaid ? $today : null;
$staffId     = $user['staff_id'];            // who is taking the order: the staff member logged in on the server session

// ---------- 4. Save everything in ONE transaction ----------
$conn->begin_transaction();
try {
    // 4a. Look for a customer with this name (not case-sensitive), so we do not create duplicates.
    $sql = "SELECT customer_id FROM customers WHERE LOWER(name) = LOWER(?) LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $customerName);
    $stmt->execute();
    $existing = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if ($existing) {
        // Old customer: keep their record up to date (phone, preferred fulfillment, and the address for deliveries).
        $customerId = (int) $existing['customer_id'];
        if ($isDelivery) {
            $sql = "UPDATE customers SET phone = ?, pref_fulfillment = ?, address = ? WHERE customer_id = ?";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('sssi', $phone, $fulfillment, $address, $customerId);
        } else {
            $sql = "UPDATE customers SET phone = ?, pref_fulfillment = ? WHERE customer_id = ?";
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('ssi', $phone, $fulfillment, $customerId);
        }
        $stmt->execute();
        $stmt->close();
    } else {
        // New customer: add a row to customers. MySQL creates the customer_id (AUTO_INCREMENT).
        $newAddress = $isDelivery ? $address : null;
        $sql = "INSERT INTO customers (name, phone, address, pref_fulfillment) VALUES (?, ?, ?, ?)";
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('ssss', $customerName, $phone, $newAddress, $fulfillment);
        $stmt->execute();
        $customerId = $stmt->insert_id;
        $stmt->close();
    }

    // 4b. Add the order. Every new order starts at the first stage, "received".
    $status = 'received';
    $sql = "INSERT INTO orders (customer_id, staff_id, created_date, due_date, fulfillment, status, delivery_fee, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('iissssds', $customerId, $staffId, $today, $dueDateValue, $fulfillment, $status, $deliveryFee, $notesValue);
    $stmt->execute();
    $orderId = $stmt->insert_id;
    $stmt->close();

    // 4c. Add the chosen service to order_items (the junction table), with the subtotal we calculated above.
    $sql = "INSERT INTO order_items (order_id, service_id, quantity, subtotal) VALUES (?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('iidd', $orderId, $serviceId, $quantity, $subtotal);
    $stmt->execute();
    $stmt->close();

    // 4d. Add the order's single payment row (a paid order stores the total, an unpaid order stores 0).
    $sql = "INSERT INTO payments (order_id, amount_paid, is_paid, payment_date) VALUES (?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('idis', $orderId, $amountPaid, $isPaid, $paymentDate);
    $stmt->execute();
    $stmt->close();

    $conn->commit();   // every step worked: make the changes permanent
} catch (Throwable $e) {
    $conn->rollback(); // something failed: undo everything from this order
    error_log('WashWiz add_order failed: ' . $e->getMessage());
    send_error('The order could not be saved. Nothing was saved, please try again.', 500);
}

// ---------- 5. Tell JavaScript what was created ----------
send_success([
    'order_id'     => $orderId,
    'customer_id'  => $customerId,
    'subtotal'     => $subtotal,
    'delivery_fee' => $deliveryFee,
    'total'        => $total,
    'paid'         => $markPaid,
]);