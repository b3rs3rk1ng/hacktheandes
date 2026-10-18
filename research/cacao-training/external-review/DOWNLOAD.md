Dataset **Cocoa Diseases** can be downloaded in [Supervisely format](https://developer.supervisely.com/api-references/supervisely-annotation-json-format):

 [Download](https://assets.supervisely.com/remote/eyJsaW5rIjogInMzOi8vc3VwZXJ2aXNlbHktZGF0YXNldHMvMTI2Nl9Db2NvYSBEaXNlYXNlcy9jb2NvYS1kaXNlYXNlcy1EYXRhc2V0TmluamEudGFyIiwgInNpZyI6ICJHalowUWNobHhqRnJRWDFKaDdKQkZ1amtUYXpNRkw2TDJ5TldGSUZubWVBPSJ9?response-content-disposition=attachment%3B%20filename%3D%22cocoa-diseases-DatasetNinja.tar%22)

As an alternative, it can be downloaded with *dataset-tools* package:
``` bash
pip install --upgrade dataset-tools
```

... using following python code:
``` python
import dataset_tools as dtools

dtools.download(dataset='Cocoa Diseases', dst_dir='~/dataset-ninja/')
```
Make sure not to overlook the [python code example](https://developer.supervisely.com/getting-started/python-sdk-tutorials/iterate-over-a-local-project) available on the Supervisely Developer Portal. It will give you a clear idea of how to effortlessly work with the downloaded dataset.

The data in original format can be [downloaded here](https://www.kaggle.com/datasets/serranosebas/enfermedades-cacao-yolov4/download?datasetVersionNumber=2).