"""RAR5 header contract fixtures, independent of remote dataset contents."""
import importlib.util,struct,unittest,zlib
from pathlib import Path

SPEC=importlib.util.spec_from_file_location('rar_sampler',Path(__file__).with_name('sample_remote_rar.py'))
MOD=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(MOD)
def encode(value):
 data=bytearray()
 while value>=128:data.append((value&127)|128);value>>=7
 data.append(value);return bytes(data)
def block(body):
 data=encode(len(body))+body
 return struct.pack('<I',zlib.crc32(data))+data
class RarHeaderTests(unittest.TestCase):
 def test_vint_round_trips(self):
  for value in [0,127,128,16384,2**64-1]:
   data=encode(value);self.assertEqual(MOD.vint(data,0),(value,len(data)))
 def test_truncated_vint(self):
  with self.assertRaises(ValueError):MOD.vint(b'\x80',0)
 def test_overlong_vint(self):
  with self.assertRaises(ValueError):MOD.vint(b'\x80'*11,0)
 def test_crc_is_checked(self):
  valid=block(b'\x01\x00\x00');self.assertEqual(MOD.header(valid)['type'],1)
  invalid=bytearray(valid);invalid[-1]^=1
  with self.assertRaisesRegex(ValueError,'CRC32'):MOD.header(invalid)
 def test_multivolume_rejected(self):
  with self.assertRaisesRegex(ValueError,'Multivolume'):MOD.header(block(b'\x01\x00\x01'))
 def test_stored_and_compressed_metadata(self):
  for method in [0,3]:
   filename=b'a.jpg';body=(encode(2)+encode(2)+encode(3)+encode(4)+encode(3)+encode(32)+struct.pack('<I',zlib.crc32(b'abc'))+encode(method<<7)+encode(0)+encode(len(filename))+filename)
   parsed=MOD.header(block(body));self.assertEqual(parsed['method'],method);self.assertEqual(parsed['name'],'a.jpg');self.assertEqual(parsed['data_size'],3);self.assertEqual(parsed['data_crc32'],f'{zlib.crc32(b"abc"):08x}')
 def test_unsafe_member_rejected(self):
  filename=b'../a.jpg';body=(encode(2)+encode(2)+encode(3)+encode(4)+encode(3)+encode(32)+struct.pack('<I',0)+encode(0)+encode(0)+encode(len(filename))+filename)
  with self.assertRaisesRegex(ValueError,'Unsafe'):MOD.header(block(body))
if __name__=='__main__':unittest.main()
