# Automated-fresh-fruit-sorting-system
the system consists of a Convolutional neural network model that classify the fruit and its condition eg rotten oranges or fresh apples. the model is then deployed using TensorFlow lite on raspberry pi which controls a servo that removes the rotten fruit


## part 1: model
the model is convolutional neural network trained on 10901 image of 3 fruits,Apples, Oranges, and Bananas achieving accuracy of 98% on validation data

model summary
|  Layer (type)              |  Output Shape         |     Param    |
-----------------------------|-----------------------|--------------|
| conv2d (Conv2D)            | (None, 298, 298, 16)  |    448       |      
| max_pooling2d (MaxPooling2D )| (None, 149, 149, 16)   |  0       |  
| conv2d_1 (Conv2D)         |  (None, 147, 147, 32)   |   4640      |
| max_pooling2d_1 (MaxPooling 2D)     |  (None, 73, 73, 32)    |   0 |
| conv2d_2 (Conv2D)        |   (None, 71, 71, 64)      |  18496     |
| max_pooling2d_2 (MaxPooling  2D)   | (None, 35, 35, 64)    |   0   |      
| conv2d_3 (Conv2D)       |    (None, 33, 33, 64)     |   36928     |
| max_pooling2d_3 (MaxPooling  2D) | (None, 16, 16, 64)     |  0    |     
| conv2d_4 (Conv2D)       |    (None, 14, 14, 64)       | 36928     |
| max_pooling2d_4 (MaxPooling 2D)  | (None, 7, 7, 64)      |   0    |     
| flatten (Flatten)       |    (None, 3136)            |  0         |
| dense (Dense)             |  (None, 512)               |1606144   |
| dense_1 (Dense)         |    (None, 6)              |   3078     | 
                                                                 

Total params: 1,706,662

### [huggingFace demo](https://huggingface.co/spaces/mgama1/fresh_rotten_fruit)
