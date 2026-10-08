<?php
// update_status.php - Moves an order to another stage (the Back / Next / Complete buttons).
require_once 'db.php';

require_post();
$input     = get_json_input();
$orderId   = (int) clean_text($input['order_id'] ?? 0);
$newStatus = clean_text($input['new_status'] ?? '');

// Only the four stages of the board are allowed, so nobody can save a made-up status.
if ($orderId <= 0) {
    send_error('Missing order.');
}
if (!in_array($newStatus, ['received', 'washing', 'ready', 'done'], true)) {
    send_error('That is not a valid order status.');
}

// Make sure the order exists.
$sql = "SELECT order_id FROM orders WHERE order_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $orderId);
$stmt->execute();
$found = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$found) {
    send_error('That order no longer exists. Please refresh the page.', 404);
}

// Save the new stage in orders.status.
$sql = "UPDATE orders SET status = ? WHERE order_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('si', $newStatus, $orderId);
$stmt->execute();
$stmt->close();

send_success(['order_id' => $orderId, 'status' => $newStatus]);