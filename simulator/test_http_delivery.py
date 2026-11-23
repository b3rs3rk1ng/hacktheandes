import concurrent.futures
import gzip
import time
import unittest
from http_delivery import RepresentationCache, viewer_fleet


class DeliveryTests(unittest.TestCase):
    def test_burst_builds_one_representation_and_refreshes(self):
        cache=RepresentationCache();calls=[]
        def build():calls.append(1);return b'x'*10000
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
            values=list(pool.map(lambda _:cache.get('state',build,ttl=.1),range(200)))
        self.assertEqual(len(calls),1)
        self.assertTrue(all(v is values[0] for v in values))
        self.assertEqual(gzip.decompress(values[0][1]),values[0][0])
        time.sleep(.11);cache.get('state',build,ttl=.1)
        self.assertEqual(len(calls),2)

    def test_eviction_and_file_revision_keys(self):
        cache=RepresentationCache(max_bytes=25,max_entries=2)
        cache.get(('a',1),lambda:b'old');cache.get(('a',2),lambda:b'new')
        self.assertEqual(cache.get(('a',2),lambda:b'wrong')[0],b'new')
        for i in range(10):cache.get(i,lambda:b'1234567890')
        self.assertLessEqual(cache.size,25);self.assertLessEqual(len(cache.entries),2)

    def test_viewer_projection_preserves_map_flags_and_authority_records(self):
        fleet={'host_lease':{'host_id':'private'},'events':list(range(40)),
               'tasks':{'task':{'status':'awaiting_review'}},
               'coverage':{'scouted':{'a':{'frames':['real']}},'inspected':{'robot':{'b':{'frames':['real']}}},'completed':{'b':{}}}}
        view=viewer_fleet(fleet)
        self.assertEqual(view['coverage']['scouted'],{'a':True})
        self.assertEqual(view['coverage']['inspected'],{'robot':{'b':True}})
        self.assertEqual(view['events'],list(range(20,40)))
        self.assertEqual(view['tasks'],fleet['tasks']);self.assertNotIn('host_lease',view)
        self.assertEqual(fleet['coverage']['scouted']['a']['frames'],['real'])
        self.assertIn('completed',fleet['coverage'])


if __name__=='__main__':unittest.main()
