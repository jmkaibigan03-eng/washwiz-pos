<?php
// delete_service.php - Deletes a service (Admin only).
require_once 'db.php';
require_once 'auth.php';

require_post();
// Real security: the browser's "unlocked" flag can be faked, so the SERVER checks the admin session here.
require_admin();

$input     = get_json_input();
$serviceId = (int) clean_text($input['service_id'] ?? 0);

if ($serviceId <= 0) {
    send_error('Missing service.');
}

// order_items.service_id uses ON DELETE CASCADE, so deleting a service that old orders used
// would silently delete those order items too. To protect the order history, refuse in that case.
$sql = "SELECT COUNT(*) AS used_count FROM order_items WHERE service_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $serviceId);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ((int) $row['used_count'] > 0) {
    send_error('This service is used by ' . (int) $row['used_count'] . ' order(s), so it cannot be deleted.', 409);
}

// Nobody uses it: it is safe to delete.
$sql = "DELETE FROM services WHERE service_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $serviceId);
$stmt->execute();
$deleted = $stmt->affected_rows;
$stmt->close();

if ($deleted === 0) {
    send_error('That service no longer exists. Please refresh the page.', 404);
}

send_success(['id' => $serviceId]);