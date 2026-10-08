<?php
// get_orders.php - Sends every order to the order board.
// The data lives in 5 tables, so we JOIN them here and JavaScript receives one simple list.
require_once 'db.php';

// Get all orders together with their customer, service, item and payment.
// order_items is the junction table (orders <-> services). The UI shows ONE service per order, so we take the
// first item of each order (the WHERE with MIN) to make sure every order appears only once.
// payments is a LEFT JOIN so an order without a payment row still shows up (as unpaid).
$sql = "SELECT o.order_id, o.customer_id, c.name AS customer_name, c.phone, c.address AS customer_address,
               oi.service_id, s.service_name, s.unit, oi.quantity, oi.subtotal,
               o.delivery_fee, o.status, o.fulfillment, o.due_date, o.created_date, o.notes, p.is_paid
        FROM orders o
        JOIN customers c     ON c.customer_id = o.customer_id
        JOIN order_items oi  ON oi.order_id = o.order_id
        JOIN services s      ON s.service_id = oi.service_id
        LEFT JOIN payments p ON p.order_id = o.order_id
        WHERE oi.order_item_id = (SELECT MIN(first_item.order_item_id)
                                    FROM order_items first_item
                                   WHERE first_item.order_id = o.order_id)
        ORDER BY o.order_id";
$stmt = $conn->prepare($sql);
$stmt->execute();
$result = $stmt->get_result();

// Rename the columns to the names app.js already uses, and work out the total (subtotal + delivery fee).
$stages = ['received', 'washing', 'ready', 'done'];
$orders = [];
while ($row = $result->fetch_assoc()) {
    $subtotal = (float) $row['subtotal'];
    $fee      = (float) $row['delivery_fee'];
    $orders[] = [
        'id'          => (int) $row['order_id'],            // app.js shows it as ORD-0015
        'customer_id' => (int) $row['customer_id'],
        'customer'    => $row['customer_name'],
        'phone'       => $row['phone'],
        'service_id'  => (int) $row['service_id'],
        'service'     => $row['service_name'],
        'unit'        => $row['unit'],
        'qty'         => (float) $row['quantity'],
        'subtotal'    => $subtotal,
        'fee'         => $fee,
        'total'       => round($subtotal + $fee, 2),
        // An unknown or empty status is shown as "received" so the order never disappears from the board.
        'status'      => in_array($row['status'], $stages, true) ? $row['status'] : 'received',
        'fulfillment' => $row['fulfillment'],
        // The schema has no address column on orders, so a delivery order shows the customer's address.
        'address'     => ($row['fulfillment'] === 'Home Delivery') ? (string) $row['customer_address'] : '',
        'due'         => $row['due_date'],
        'notes'       => $row['notes'],
        'paid'        => ((int) $row['is_paid'] === 1),
        'created'     => $row['created_date'],
    ];
}
$stmt->close();

send_success($orders);