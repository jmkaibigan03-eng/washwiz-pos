<?php
// delete_order.php - Deletes one order.
require_once 'db.php';

require_post();
$input   = get_json_input();
$orderId = (int) clean_text($input['order_id'] ?? 0);

if ($orderId <= 0) {
    send_error('Missing order.');
}

// Delete the order. Its order_items and its payment are deleted automatically by MySQL (ON DELETE CASCADE).
$sql = "DELETE FROM orders WHERE order_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $orderId);
$stmt->execute();
$deleted = $stmt->affected_rows;
$stmt->close();

if ($deleted === 0) {
    send_error('That order no longer exists. Please refresh the page.', 404);
}

send_success(['order_id' => $orderId]);