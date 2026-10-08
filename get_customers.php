<?php
// get_customers.php - Sends every customer to the Customers page, with their number of orders and total spent.
require_once 'db.php';

// Get all customers. The subqueries count each customer's orders and add up what they were charged
// (item subtotals + delivery fees), so JavaScript does not have to calculate anything.
$sql = "SELECT c.customer_id, c.name, c.phone, c.address, c.pref_fulfillment,
               (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.customer_id) AS order_count,
               (SELECT COALESCE(SUM(oi.subtotal), 0)
                  FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
                 WHERE o.customer_id = c.customer_id)
             + (SELECT COALESCE(SUM(o.delivery_fee), 0)
                  FROM orders o WHERE o.customer_id = c.customer_id) AS total_spent
        FROM customers c
        ORDER BY c.customer_id";
$stmt = $conn->prepare($sql);
$stmt->execute();
$result = $stmt->get_result();

// Rename the columns to the names app.js already uses.
$customers = [];
while ($row = $result->fetch_assoc()) {
    $customers[] = [
        'id'          => (int) $row['customer_id'],
        'name'        => $row['name'],
        'phone'       => $row['phone'],
        'address'     => $row['address'],
        'fulfillment' => $row['pref_fulfillment'],   // the "Preferred" column
        'order_count' => (int) $row['order_count'],
        'total_spent' => (float) $row['total_spent'],
    ];
}
$stmt->close();

send_success($customers);