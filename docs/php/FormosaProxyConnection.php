<?php
/**
 * Copy connectApiProtocol() into cms/application/libraries/partner/Formosa.php,
 * replacing its existing method. The trait is a lintable/testable container;
 * alternatively use the trait if that class has no method with the same name.
 * Requires PHP 7.4+ and ext-curl. Never return [] to signal a failed import.
 */
trait FormosaProxyConnection
{
    public function connectApiProtocol()
    {
        $failure = static function () {
            return array('statusCode' => 502, 'error' => 'formosa_proxy_failed');
        };
        $url = getenv('FORMOSA_PROXY_URL');
        $token = getenv('FORMOSA_PROXY_TOKEN');
        if (!is_string($url) || !is_string($token) || $token === '' || preg_match('/\s/', $token)
            || !filter_var($url, FILTER_VALIDATE_URL) || !function_exists('curl_init')) {
            return $failure();
        }
        $parts = parse_url($url);
        if (!is_array($parts) || strtolower($parts['scheme'] ?? '') !== 'https'
            || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['fragment'])) {
            return $failure();
        }

        $curl = curl_init($url);
        if ($curl === false) {
            return $failure();
        }
        $configured = curl_setopt_array($curl, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPGET => true,
            CURLOPT_HTTPHEADER => array('Accept: application/json', 'Authorization: Bearer ' . $token),
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 65,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ));
        if (!$configured) {
            curl_close($curl);
            return $failure();
        }
        $raw = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);
        // Do not log the URL, headers, body, curl_error(), or upstream diagnostics.
        if ($status !== 200 || !is_string($raw) || substr(ltrim($raw), 0, 1) !== '[') {
            return $failure();
        }
        $tours = json_decode($raw, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($tours)) {
            return $failure();
        }
        foreach ($tours as $tour) {
            if (!is_array($tour)) {
                return $failure();
            }
            foreach (array('mainid', 'title', 'banner', 'pdf', 'doc') as $field) {
                if (!isset($tour[$field]) || !is_string($tour[$field])) {
                    return $failure();
                }
            }
            if ($tour['mainid'] === '' || !isset($tour['tour_day'], $tour['tour_night'])
                || !is_int($tour['tour_day']) || !is_int($tour['tour_night'])
                || !isset($tour['flights'], $tour['period'])
                || !is_array($tour['flights']) || !is_array($tour['period'])) {
                return $failure();
            }
            foreach ($tour['flights'] as $flight) {
                if (!is_array($flight)) {
                    return $failure();
                }
                foreach (array('flight_direction', 'from_airport', 'to_airport', 'flight_no', 'depart_time', 'arrive_time') as $field) {
                    if (!isset($flight[$field]) || !is_string($flight[$field])) {
                        return $failure();
                    }
                }
                if (!in_array($flight['flight_direction'], array('depart', 'return'), true)) {
                    return $failure();
                }
            }
            foreach ($tour['period'] as $period) {
                if (!is_array($period)) {
                    return $failure();
                }
                foreach (array('tour_period', 'price', 'price_old', 'Chd+B', 'ChdNB', 'single', 'size', 'Book', 'AVBL', 'comOffice', 'comSale') as $field) {
                    if (!isset($period[$field]) || !is_string($period[$field])) {
                        return $failure();
                    }
                }
            }
        }
        return $tours;
    }
}
