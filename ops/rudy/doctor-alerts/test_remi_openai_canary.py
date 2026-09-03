import importlib.util
import unittest
import urllib.error
from pathlib import Path


class Response:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body


class RemiOpenAICanaryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).with_name("remi_openai_canary.py")
        spec = importlib.util.spec_from_file_location("remi_canary", path)
        cls.canary = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.canary)

    def test_retries_server_errors_then_succeeds(self):
        attempts = []

        def opener(request, timeout):
            attempts.append((request.full_url, timeout))
            if len(attempts) < 3:
                raise urllib.error.HTTPError(request.full_url, 500, "", {}, None)
            return Response(b'{"data":[{"id":"gpt-5.6-sol"}]}')

        sleeps = []
        payload = self.canary.request_models("test-key", opener, sleeps.append)
        self.assertEqual(payload["data"][0]["id"], "gpt-5.6-sol")
        self.assertEqual(len(attempts), 3)
        self.assertEqual(sleeps, [0.5, 1.0])

    def test_does_not_retry_authentication_failure(self):
        attempts = []

        def opener(request, timeout):
            attempts.append((request.full_url, timeout))
            raise urllib.error.HTTPError(request.full_url, 401, "", {}, None)

        with self.assertRaises(urllib.error.HTTPError):
            self.canary.request_models("test-key", opener, lambda _seconds: None)
        self.assertEqual(len(attempts), 1)

    def test_retries_timeout(self):
        attempts = []

        def opener(_request, timeout):
            attempts.append(timeout)
            if len(attempts) == 1:
                raise TimeoutError()
            return Response(b'{"data":[]}')

        self.canary.request_models("test-key", opener, lambda _seconds: None)
        self.assertEqual(attempts, [20, 20])


if __name__ == "__main__":
    unittest.main()
