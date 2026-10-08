<?php
// get_services.php - Sends every service (and the delivery fee) to the page.
require_once 'db.php';

// Get all services from MySQL so the dropdown and the price table always show the latest prices.
$sql = "SELECT service_id, service_name, price, unit FROM services ORDER BY service_id";
$stmt = $conn->prepare($sql);
$stmt->execute();
$result = $stmt->get_result();

// Rename the columns to the names app.js already uses (id, name, price, unit).
$services = [];
while ($row = $result->fetch_assoc()) {
    $services[] = [
        'id'    => (int) $row['service_id'],
        'name'  => $row['service_name'],
        'price' => (float) $row['price'],
        'unit'  => $row['unit'],
    ];
}
$stmt->close();

send_success(['services' => $services, 'delivery_fee' => DEFAULT_DELIVERY_FEE]);