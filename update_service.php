<?php
// update_service.php - Edits an existing service (Admin only).
require_once 'db.php';
require_once 'auth.php';

require_post();
// Real security: the browser's "unlocked" flag can be faked, so the SERVER checks the admin session here.
require_admin();

$input     = get_json_input();
$serviceId = (int) clean_text($input['service_id'] ?? 0);
$name      = clean_text($input['service_name'] ?? '');
$price     = $input['price'] ?? null;
$unit      = clean_text($input['unit'] ?? '');

// Validate on the server (the browser's checks can be skipped).
if ($serviceId <= 0) {
    send_error('Missing service.');
}
if ($name === '' || strlen($name) > 100) {
    send_error('Enter a service name (up to 100 characters).');
}
if (!is_numeric($price) || $price < 0 || $price > 99999.99) {
    send_error('Enter a price between 0 and 99,999.99.');
}
if (!in_array($unit, ['kg', 'piece'], true)) {
    send_error('Charged per must be kg or piece.');
}
$price = round((float) $price, 2);

// Make sure the service exists.
$sql = "SELECT service_id FROM services WHERE service_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $serviceId);
$stmt->execute();
$found = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$found) {
    send_error('That service no longer exists. Please refresh the page.', 404);
}

// Save the changes. Old orders keep the subtotal they were charged, because order_items stores its own subtotal.
$sql = "UPDATE services SET service_name = ?, price = ?, unit = ? WHERE service_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('sdsi', $name, $price, $unit, $serviceId);
$stmt->execute();
$stmt->close();

send_success(['id' => $serviceId]);