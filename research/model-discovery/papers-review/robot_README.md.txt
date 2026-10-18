# Husky xArm6 MCR

A ROS2 Humble mobile manipulation platform for autonomous agricultural exploration, combining a **Clearpath Husky A200** ground vehicle with a **UFACTORY xArm6** robotic arm and a multi-camera vision system.

## System Overview

| Component | Description |
|-----------|-------------|
| **Platform** | Clearpath Husky A200 — 4-wheel differential drive UGV |
| **Manipulator** | UFACTORY xArm6 — 6-DOF collaborative robot arm |
| **Riser** | X-rail mounting system connecting platform to arm |
| **Sensor** | Multi-camera rig for multi-modal perception |

The system supports autonomous Next-Best-View (NBV) exploration in simulation (Gazebo Ignition Fortress) and on real hardware, with MoveIt2 for motion planning and octomap-based 3D occupancy mapping.

## Package Structure

| Package | Description |
|---------|-------------|
| [`husky_xarm6_mcr_bringup`](husky_xarm6_mcr_bringup/README.md) | Main launch orchestration — starts Gazebo, ros2_control, MoveIt2, and RViz |
| [`husky_xarm6_mcr_control`](husky_xarm6_mcr_control/README.md) | ros2_control configuration and controller spawning for platform + arm |
| [`husky_xarm6_mcr_description`](husky_xarm6_mcr_description) | URDF/SRDF robot models, meshes, and RViz configs |
| [`husky_xarm6_mcr_gz`](husky_xarm6_mcr_gz/README.md) | Gazebo worlds (apple orchard, empty), models, and viewpoint capture utilities |
| [`husky_xarm6_mcr_moveit_config`](husky_xarm6_mcr_moveit_config) | MoveIt2 configuration — joint limits, kinematics, OMPL planners |
| [`husky_xarm6_mcr_moveit_servo`](husky_xarm6_mcr_moveit_servo) | Real-time teleoperation via MoveIt Servo + Xbox controller |
| [`husky_xarm6_mcr_nbv_planner`](husky_xarm6_mcr_nbv_planner/README.md) | Next-Best-View autonomous exploration planner |
| [`husky_xarm6_mcr_occupancy_map`](husky_xarm6_mcr_occupancy_map) | 3D occupancy mapping with octomap and MoveIt2 planning scene integration |

## Prerequisites

- **OS**: Ubuntu 22.04
- **ROS2**: [Humble](https://docs.ros.org/en/humble/Installation.html)
- **Simulator**: Gazebo Ignition Fortress (`ros-humble-ros-gz`)
- **Dependencies**: Managed via `rosdep` and `dependencies.repos`

## Installation

1. Install ROS2 Humble by following the [official guide](https://docs.ros.org/en/humble/Installation.html).

2. Create a workspace and clone this repo under `src`:
   ```bash
   mkdir -p ~/ros2_ws/src
   cd ~/ros2_ws/src
   git clone https://github.com/Feddockh/husky_xarm6_mcr.git
   ```

3. Import dependency repositories using vcstool:
   ```bash
   # Install vcs if needed
   sudo apt install python3-vcstool

   cd ~/ros2_ws
   vcs import src/ < src/husky_xarm6_mcr/dependencies.repos
   ```

4. Install ROS2 package dependencies via rosdep:
   ```bash
   source /opt/ros/humble/setup.bash
   rosdep update
   rosdep install --from-paths src/ --ignore-src -r -y
   ```

5. Update the git submodules inside the multi-camera rig package:
   ```bash
   git -C src/multi_camera_rig_v3 submodule update --init --recursive
   ```

6. Sync and update the xArm packages:
   ```bash
   git -C src/xarm_ros2 submodule sync --recursive && \
   git -C src/xarm_ros2 submodule update --init --recursive
   ```

7. Build and source the workspace:
   ```bash
   colcon build --symlink-install
   source install/setup.bash
   ```

## Quick Start

### Simulation (Gazebo)

Launch the full system in the default apple orchard world:

```bash
ros2 launch husky_xarm6_mcr_bringup bringup.launch.py
```

Common argument combinations:

| Command | Description |
|---------|-------------|

| `bringup.launch.py world:=empty use_gazebo:=true use_sim_time:=true` | Empty Gazebo world |
| `bringup.launch.py world:=apple_orchard use_gazebo:=true use_sim_time:=true` | Apple orchard world |
| `bringup.launch.py world:=apple_tree_1 use_gazebo:=true use_sim_time:=true` | Fire blight infected apple tree world |
| `bringup.launch.py world:=/path/to/custom.sdf` | Custom world file |

### Real Hardware

```bash
ros2 launch husky_xarm6_mcr_bringup bringup.launch.py \
    use_gazebo:=false \
    robot_ip:=192.168.1.205 \
    use_sim_time:=false
```

Set `robot_ip` to match your xArm6's network address.

## Next-Best-View Planner

The [`husky_xarm6_mcr_nbv_planner`](husky_xarm6_mcr_nbv_planner/README.md) package provides autonomous exploration via an 8-step loop: frontier detection → k-means clustering → viewpoint generation → workspace filtering → information gain (ray-casting) → utility scoring → IK/collision validation → motion execution. See its [README](husky_xarm6_mcr_nbv_planner/README.md) for full documentation and launch instructions.

## License

Individual packages contain their own LICENSE files.
