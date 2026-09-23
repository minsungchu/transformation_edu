# Transformation Education

로봇 좌표계 이론(transformation matrix, 좌표계, 캘리브레이션, 매칭)을 교육하기 위한 웹 기반 튜토리얼 교재 프로젝트. reference 폴더의 원본 자료를 기반으로 내용을 재구성한다.

## Language

### 수식 표기 (Notation)

**Transformation Matrix — $T^{A}_{B}$**:
위첨자 A = 기준(reference) 좌표계, 아래첨자 B = 타겟(대상) 좌표계인 4×4 행렬. 읽는 법은 두 가지이며 같은 행렬을 두 관점에서 말한 것이다: (1) "A 좌표계 기준의 B 좌표계", (2) "B 좌표계상의 좌표를 A 좌표계상의 좌표로 변환하는 변환행렬" — $P^{A} = T^{A}_{B} \cdot P^{B}$. 체인룰에서 인접 인덱스가 소거된다: $T^{A}_{C} = T^{A}_{B} \cdot T^{B}_{C}$.
_Avoid_: 위첨자·아래첨자를 반대로 쓰는 표기 (reference 원문 표기 — 교재에서는 전부 이 규칙으로 교체); "A에서 B로", "A to B", "From A To B" 같은 방향 표현 (두 읽기가 서로 반대 방향처럼 들려 혼동을 낳는다)

**변수 표기 — `T_A_B`**:
코드·문서에서 $T^{A}_{B}$를 변수로 적을 때는 `T_<A>_<B>` 형식이며 첨자 순서(기준, 타겟)를 그대로 따른다. A와 B는 각각 camelCase로 적는다. 예: `T_world_camera`, `T_flange_tcp`, `T_world_userFrame`.
_Avoid_: `T_A_to_B`, `T_AtoB`, `T_AB`처럼 순서·방향을 다른 방식으로 적는 변수명

**Point / Vector — $P^{A}$ 또는 $P^{A}_{name}$**:
위첨자 A = 이 점(벡터)이 표현되는 좌표계. 아래첨자는 (있다면) 좌표계가 아니라 어떤 점인지 가리키는 이름이다. 예: $P^{camera}_{scene}$ = camera 좌표계에서 표현된 scene의 picking point.
_Avoid_: 위첨자에 대상 이름, 아래첨자에 좌표계를 표기 (reference 원문 방식, 예: $P^{scene}_{camera}$)

**변환 화살표 도식 (Arrow diagram)**:
도식과 위젯에서 $T^{A}_{B}$는 화살표 하나로 그린다 — 꼬리 = 위첨자(기준 A) 좌표계 원점, 화살촉 = 아래첨자(타겟 B) 좌표계 원점. 좌표계 원점에 꼬리를 두고 점을 가리키는 화살표는 그 좌표계에서 표현된 $P$를 뜻한다. 화살표를 말로 풀 때도 "A 기준의 B"로 읽고 "A에서 B로"라고 하지 않는다.

**회전 표현 (Rotation representation)**:
회전각 표현은 passive(Euler) 방식으로 통일한다 — 회전할 때마다 좌표계가 함께 회전하며, 다음 회전은 회전된 좌표계 기준으로 이뤄진다. active(RPY, 고정 좌표계 기준)는 개념 비교 시에만 언급한다.
_Avoid_: active(RPY)를 기본 표현으로 사용

### 좌표계 (Frames)

**World 좌표계**:
Robot Base를 원점으로 하는 기준 좌표계. 일반 로보틱스 문헌은 World와 Robot Base를 구분하기도 하지만, 이 교재는 World로 통일한다 (교재 1단계에 차이 주석 포함).
_Avoid_: Robot 좌표계, Base 좌표계

**Flange 좌표계**:
로봇 6축(마지막 관절) 원점에 붙은 좌표계. 로봇이 기구학적으로 제어하는 지점이며, IK가 푸는 체인의 끝점이다. +z가 공구가 뻗는 approach 축이다 (URDF의 ROS-Industrial `tool0` 프레임과 같은 규약).
_Avoid_: 6축 좌표계, Wrist 좌표계

**Tool 좌표계**:
Tooltip(TCP)을 원점으로 하는 좌표계. TCP(Tool Center Point)는 Tool 좌표계의 원점이다. 공구를 장착하면 TCP는 공구 끝단(예: 석션 패드의 접촉면)이며, Flange 좌표계와는 고정 오프셋 $T^{flange}_{tcp}$로 이어진다 — 조그의 회전중심이 6축 원점인지 공구 끝단인지가 이 오프셋만큼 달라진다.

**Camera 좌표계**:
Camera(Sensor)를 기준으로 하는 좌표계.
_Avoid_: Sensor 좌표계, Scene 좌표계

**User 좌표계**:
작업대·지그 등 작업 환경을 기준으로 사용자가 직접 정의하는 좌표계. 수식으로는 $T^{world}_{user}$ 하나로 표현되며, 조그(jog)의 기준 좌표계 선택지(world / tcp / user) 중 하나다.

### 센서 부착 방식 (Mount)

**Fixed Post (Eye-to-Hand)**:
카메라를 기둥·프레임 등 고정 구조물에 설치하는 방식. Camera 좌표계가 셀에 고정되어 World 좌표계와의 관계 $T^{world}_{camera}$가 상수다. 눈(카메라)이 손(로봇)을 바라본다는 뜻의 Eye-to-Hand.
_Avoid_: Post Mount, 고정 마운트

**Hand-Eye (Eye-in-Hand)**:
카메라를 로봇 플랜지 쪽에 부착하는 방식. Camera 좌표계가 로봇과 함께 움직이며 Flange 좌표계와의 관계 $T^{flange}_{camera}$가 상수다. 눈이 손에 달려 있다는 뜻의 Eye-in-Hand.
_Avoid_: Robot Mount

### 의미적 명칭 (Semantic names)

**w2s / f2s / v2r**:
캘리브레이션 관계를 가리키는 의미적 명칭이다 (w2s: World-To-Scene, f2s: Flange-To-Scene, v2r: Vision-To-Robot). 수식 표기가 아니므로 첨자 규칙과 무관하며, 수식에서 정확성이 필요할 때는 항상 $T^{A}_{B}$ 표기를 사용한다.

**$T_{cal}$ / $T_{match}$**:
역할로 이름 붙인 transformation (calibration 결과, matching 결과). 이때 아래첨자는 좌표계가 아니라 이름이다 — 좌표계 첨자 규칙과 혼동하지 말 것.
