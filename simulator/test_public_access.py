import tempfile
from pathlib import Path
import unittest
from access import authorized
from fleet_core import Fleet


class PublicContract(unittest.TestCase):
    def test_anonymous_read_session_cannot_operate(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.assertTrue(authorized({},root))
            (root/'operator-token.txt').write_text('test-operator-secret')
            self.assertFalse(authorized({},root));self.assertFalse(authorized({'Authorization':'Bearer wrong'},root))
            self.assertTrue(authorized({'Authorization':'Bearer test-operator-secret'},root))

    def test_only_one_authoritative_host_and_expired_lease_can_recover(self):
        now=[100];fleet=Fleet({'fleet':{'robots':[]}},clock=lambda:now[0])
        self.assertTrue(fleet.lease('first-host')['granted']);self.assertFalse(fleet.lease('second-host')['granted'])
        self.assertTrue(fleet.lease('first-host')['granted']);now[0]+=9
        self.assertTrue(fleet.lease('second-host')['granted'])


if __name__=='__main__':unittest.main()
