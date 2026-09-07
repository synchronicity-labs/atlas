import io
import unittest
import urllib.error
from unittest.mock import Mock, patch

from atlas_http import NoRedirect, RateLimited, request_json, retry_delay


class AtlasHttpTest(unittest.TestCase):
    def test_redirect_never_forwards_a_credential(self):
        with self.assertRaisesRegex(RuntimeError, "refused a redirect"):
            NoRedirect().redirect_request(None, None, 302, "", {}, "https://elsewhere.invalid")

    def test_rate_limit_preserves_retry_after_without_error_body(self):
        opener = Mock()
        opener.open.side_effect = urllib.error.HTTPError("https://slack.com", 429, "private", {"Retry-After": "900"}, io.BytesIO(b"private"))
        with patch("urllib.request.build_opener", return_value=opener):
            with self.assertRaises(RateLimited) as raised:
                request_json("https://slack.com", "secret", {})
        self.assertEqual(raised.exception.retry_after, 900)
        self.assertNotIn("private", str(raised.exception))

    def test_retry_after_invalid_values_use_a_safe_delay(self):
        for value in [None, "invalid", "nan", "inf"]:
            self.assertEqual(retry_delay(value), 60)
        self.assertEqual(retry_delay("0"), 1)
        self.assertEqual(retry_delay("1.1"), 2)

    def test_request_uses_bearer_auth_and_rejects_non_object_response(self):
        response = Mock()
        response.read.return_value = b"[]"
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = response
        with patch("urllib.request.build_opener", return_value=opener):
            with self.assertRaisesRegex(RuntimeError, "not an object"):
                request_json("https://example.invalid", "secret")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")
        self.assertEqual(request.method, "GET")


if __name__ == "__main__":
    unittest.main()
