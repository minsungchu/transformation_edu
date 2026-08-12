# URDF 모델

로봇 셀 3D 뷰어(`src/components/RobotCellViewer`)가 사용하는 URDF와 메시.

## ur5e

- `ur5e.urdf` + `ur_description/meshes/ur5e/visual/*.dae`
- 출처: [Daniella1/urdf_files_dataset](https://github.com/Daniella1/urdf_files_dataset)의
  `urdf_files/matlab/ur_e_description` (원출처: MathWorks Robotics System Toolbox
  Robot Library Data, Universal Robots UR5e). 라이선스: BSD-3-Clause — `LICENSE.txt` 참조.
- URDF 안의 `package://ur_description/...` 참조는 뷰어 config(`robots.ts`)의
  `packages` 매핑으로 이 폴더에 연결된다.

## 모델 추가/교체

1. `static/urdf/<모델>/`에 URDF와 메시를 넣는다 (라이선스 명시 필수).
2. `src/components/RobotCellViewer/robots.ts`의 `ROBOT_MODELS`에 엔트리를 추가한다.
3. MDX에서 `<RobotCellViewer robot="<키>" />`로 사용한다.
