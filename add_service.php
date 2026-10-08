<?php
// add_service.php - Adds a new service (Admin only).
require_once 'db.php';
require_once 'auth.php';

require_post();
// Real security: the browser's "unlocked" flag can be faked, so the SERVER checks the admin session here.
require_admin();

$input = get_json_input();
$name  = clean_text($input['service_name'] ?? '');
$price = $input['price'] ?? null;
$unit  = clean_text($input['unit'] ?? '');

// Validate on the server (the browser's checks can be skipped).
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

// Add the new service. MySQL's AUTO_INCREMENT creates the service_id for us.
$sql = "INSERT INTO services (service_name, price, unit) VALUES (?, ?, ?)";
$stmt = $conn->prepare($sql);
$stmt->bind_param('sds', $name, $price, $unit);
$stmt->execute();
$newId = $stmt->insert_id;
$stmt->close();

send_success(['id' => $newId]);