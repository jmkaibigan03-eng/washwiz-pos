<?php
// delete_customer.php - The "Remove" button on the Customers page.
require_once 'db.php';

require_post();
$input      = get_json_input();
$customerId = (int) clean_text($input['customer_id'] ?? 0);

if ($customerId <= 0) {
    send_error('Missing customer.');
}

// orders.customer_id uses ON DELETE CASCADE, so deleting a customer would also wipe all of their orders.
// To protect the order history, count the customer's orders first and refuse if there are any.
$sql = "SELECT COUNT(*) AS order_count FROM orders WHERE customer_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $customerId);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ((int) $row['order_count'] > 0) {
    send_error('This customer still has ' . (int) $row['order_count'] . ' order(s). Delete those orders first.', 409);
}

// No orders: it is safe to delete the customer.
$sql = "DELETE FROM customers WHERE customer_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $customerId);
$stmt->execute();
$deleted = $stmt->affected_rows;
$stmt->close();

if ($deleted === 0) {
    send_error('That customer no longer exists. Please refresh the page.', 404);
}

send_success(['customer_id' => $customerId]);