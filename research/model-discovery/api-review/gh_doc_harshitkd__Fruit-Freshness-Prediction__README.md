# Fruit-Freshness-Prediction

## Introduction
What's Fresh & What's Rotten is our way to solve problem about fruits classification whether it is rotten or it is fresh (safely can be eaten) using Deep Learning. We do simple CNN to expect some basic performance. Then we improved the model by adding Transfer Learning with VGG-16 and ResNet50 as our baseline model.

## Dataset
Used the [Fruit fresh and rotten for classification](https://www.kaggle.com/sriramr/fruits-fresh-and-rotten-for-classification) kaggle dataset.
The dataset contains 13599 images of apple, banana and orange divided into fresh and rotten each.

Dataset       | Directories     | Files
------------- | -------------   | -------------
Train         | freshapples     | 1693
|             | freshbanana     | 1581
|             | freshoranges    | 1466
|             | rottenapples    | 2342
|             | rottenbanana    | 2224
|             | rottenoranges   | 1595
Test          | freshapples     | 395
|             | freshbanana     | 381
|             | freshoranges    | 388
|             | rottenapples    | 601
|             | rottenbanana    | 530
|             | rottenoranges   | 403

![test_train dataset](https://user-images.githubusercontent.com/56076028/148802937-949c3ca9-6c2a-4337-94d5-5085a9d853cd.jpg)

## Technolgies Used

* [Convolutional Neural Network](https://www.tensorflow.org/tutorials/images/cnn):
* [ResNet50V2](https://keras.io/api/applications/resnet/)
* [VGG16](https://keras.io/api/applications/vgg/)
* Sequential Models
* Sklearn
* Tensorflow
* Keras
* OpenCV


## Algorithm

Process how the project was done:

* Getting the information of the dataset.
* Randomly choosing the fruit image to get the size of the image and also its preview.
* Resizing the images to size of (150,150) and scaling both the train and test datasets.
* Used sequential model (3 layer convolutional layer), ResNet50 model and VGG-16 using transfer learning.
* Plot the accuracy and loss metric.
* Evaluate the accuracy of the model.
* Predict the image from test dataset.

## Models

Model                      | Total Parameters     | Loss     | Accuracy  | Optimizer | Loss metric
-------------              | -------------        | -------- | ----------| --------- | -------------------------
Sequential 3 layer         | 9,497,126            | 0.0960   | 96.96%    | RMSprop   | Categorical CrossEntropy
ResNet50V2                 | 23,696,326           | 0.0259   | 97.41%    | Adam      | Binary CrossEntropy
VGG16                      | 14,747,910           | 0.108         | 91.4%     | Adam      | Binary CrossEntropy

## Result

<pre>
from keras.preprocessing.image import img_to_array

names = [fresh_apples_test_dir,
         fresh_banana_test_dir,
         fresh_oranges_test_dir,
         rotten_apples_test_dir,
         rotten_banana_test_dir,
         rotten_oranges_test_dir
]
name_rand = random.choice(names)


filename = os.listdir(name_rand)
sample = random.choice(filename)
fn = os.path.join(name_rand,sample)
print(fn)


img = load_img(fn, target_size=(150, 150))
plt.imshow(img)


x = img_to_array(img)
x = np.expand_dims(x, axis=0)
images = np.vstack([x])
classes = model.predict(images, batch_size=10)
print(classes)


prediction = ''

if classes[0][0]==1:
    prediction = 'fresh apple'
elif classes[0][1]==1:
    prediction = 'fresh banana'
elif classes[0][2]==1:
    prediction = 'fresh orange'
elif classes[0][3]==1:
    prediction = 'rotten apple'
elif classes[0][4]==1:
    prediction = 'rotten banana'
elif classes[0][5]==1:
    prediction = 'rotten orange'

print(prediction)
</pre>

![prediction result](https://user-images.githubusercontent.com/56076028/148802492-61e08bf6-d4c9-4a32-a725-3fa8300a2b48.jpg)

## Future Enhancement
To make a website integrated with IoT devices to detect whether fruit is rotten or not in real-time.


## References
I have taken references from:
* [Research Papers](https://github.com/harshitkd/Fruit-Freshness-Prediction/tree/main/reference%20Docs)
* [A guide to an efficient way to build neural network architecture](https://towardsdatascience.com/a-guide-to-an-efficient-way-to-build-neural-network-architectures-part-ii-hyper-parameter-42efca01e5d7)
* [Convolutional neural network for visual recognition](https://cs231n.github.io/convolutional-networks/)



