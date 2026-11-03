import hashlib
import tempfile
import unittest
from storage import Store, Conflict


class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(self.tmp.name+'/disk.sqlite')
        self.a = self.store.claim('computer-a')

    def tearDown(self):
        self.store.db.close()
        self.tmp.cleanup()

    def test_takeover_fences_previous_computer(self):
        with self.assertRaises(Conflict):
            self.store.claim('computer-b')
        b = self.store.claim('computer-b', True)
        with self.assertRaises(Conflict):
            self.store.heartbeat('computer-a', self.a['lease'])
        self.store.heartbeat('computer-b', b['lease'])

    def test_incomplete_upload_keeps_previous_save(self):
        with self.assertRaises(ValueError):
            self.store.commit('computer-a', self.a['lease'], 0,
                              {'format':'hk-desktop-idb-v1','chunks':['a'*64]})
        self.assertEqual(self.store.claim('computer-b', True)['revision'], 0)

    def test_restore_and_revision_guard(self):
        data = b'installed tools, files and settings'
        key = hashlib.sha256(data).hexdigest()
        self.store.put('computer-a', self.a['lease'], key, data)
        manifest = {'format':'hk-desktop-idb-v1','chunks':[key]}
        self.store.commit('computer-a', self.a['lease'], 0, manifest)
        with self.assertRaises(Conflict):
            self.store.commit('computer-a', self.a['lease'], 0, manifest)
        b = self.store.claim('computer-b', True)
        self.assertEqual(b['manifest'], manifest)
        self.assertEqual(self.store.read('computer-b', b['lease'], key), data)

    def test_corrupt_data_rejected(self):
        with self.assertRaises(ValueError):
            self.store.put('computer-a', self.a['lease'], 'a'*64, b'wrong')

    def test_resume_after_new_login_and_takeover_fencing(self):
        lease = self.a['lease']
        self.store.resume('new-login', lease)
        with self.assertRaises(Conflict):
            self.store.heartbeat('computer-a', lease)
        self.store.heartbeat('new-login', lease)
        self.store.claim('other-computer', True)
        with self.assertRaises(Conflict):
            self.store.resume('new-login', lease)

    def test_interrupted_upload_cleanup_preserves_last_save(self):
        first = b'first save'
        first_hash = hashlib.sha256(first).hexdigest()
        self.store.put('computer-a', self.a['lease'], first_hash, first)
        self.store.commit('computer-a', self.a['lease'], 0, {'format':'hk-desktop-idb-v1','chunks':[first_hash]})
        abandoned = b'interrupted upload'
        abandoned_hash = hashlib.sha256(abandoned).hexdigest()
        self.store.put('computer-a', self.a['lease'], abandoned_hash, abandoned)
        head = self.store.begin('computer-a', self.a['lease'])
        self.assertEqual(head['revision'], 1)
        self.assertEqual(self.store.read('computer-a', self.a['lease'], first_hash), first)
        with self.assertRaises(ValueError):
            self.store.read('computer-a', self.a['lease'], abandoned_hash)

    def test_expired_writer_cannot_save(self):
        self.store.clock = lambda: 10**12
        with self.assertRaises(Conflict):
            self.store.commit('computer-a', self.a['lease'], 0,
                              {'format':'hk-desktop-idb-v1','chunks':[]})


if __name__ == '__main__':
    unittest.main()
