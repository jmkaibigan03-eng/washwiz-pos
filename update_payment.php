<?php
// update_payment.php - The "Mark paid" / "Mark unpaid" button.
// payments.order_id is UNIQUE, so an order can only have ONE payment row:
// we UPDATE that row if it exists, and INSERT it only if it does not.
require_once 'db.php';

require_post();
$input   = get_json_input();
$orderId = (int) clean_text($input['order_id'] ?? 0);
$isPaid  = (($input['is_paid'] ?? false) === true) ? 1 : 0;

if ($orderId <= 0) {
    send_error('Missing order.');
}

// Work out the order total in MySQL (items subtotal + delivery fee). The amount never comes from the browser.
$sql = "SELECT o.delivery_fee,
               (SELECT COALESCE(SUM(oi.subtotal), 0) FROM order_items oi WHERE oi.order_id = o.order_id) AS items_total
        FROM orders o
        WHERE o.order_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $orderId);
$stmt->execute();
$order = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$order) {
    send_error('That order no longer exists. Please refresh the page.', 404);
}

$total       = round((float) $order['items_total'] + (float) $order['delivery_fee'], 2);
$amountPaid  = $isPaid ? $total : 0.00;               // paid = full total, unpaid = 0
$paymentDate = $isPaid ? date('Y-m-d') : null;        // unpaid orders have no payment date

// Does this order already have a payment row?
$sql = "SELECT payment_id FROM payments WHERE order_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $orderId);
$stmt->execute();
$payment = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($payment) {
    // Yes: update the existing row (we never add a second payment row for the same order).
    $sql = "UPDATE payments SET amount_paid = ?, is_paid = ?, payment_date = ? WHERE order_id = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('disi', $amountPaid, $isPaid, $paymentDate, $orderId);
} else {
    // No: create the order's payment row.
    $sql = "INSERT INTO payments (order_id, amount_paid, is_paid, payment_date) VALUES (?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('idis', $orderId, $amountPaid, $isPaid, $paymentDate);
}
$stmt->execute();
$stmt->close();

send_success(['order_id' => $orderId, 'paid' => ($isPaid === 1), 'amount_paid' => $amountPaid]);