# 로컬 보안 CI 경계

이 검사는 고정 Gitleaks8.30.1·Trivy0.76.1 Linux CLI를 공식 GitHub release에서 내려받고, 검토한 SHA256으로 검증한 뒤 runner에서 실행한다. LLM·외부 코드 업로드·운영 비밀·유료 CodeQL은 사용하지 않는다. GitHub Actions 실행 시간·공개 취약점 DB 다운로드는 늘어나며 private 저장소는 기존 Actions 사용량에 포함될 수 있다.

현재 tracked HEAD 전체와 PR base/push before 이후 새 commit diff에서 Gitleaks 기본 규칙을 검사한다. 최초 branch·수동 실행은 최신 commit과 현재 tree만 검사한다. 저장소 ignore/allow 주석은 적용하지 않는다. 과거 전체 Git 기록·삭제된 ref·짧은 미지원 비밀번호를 안전으로 인증하지 않는다. 특히 과거 SMTP 키 R09의 폐기 여부는 별도 미해결 항목이며 이 CI 통과로 해결되지 않는다.

Trivy는 tracked tree의 지원 manifest/lock에 개발 의존성까지 명시적으로 포함하고 High/Critical을 미수정 취약점까지 차단한다. telemetry/version check는 끄고 public DB를 내려받아 offline matching한다. ignorefile·baseline·VEX는 적용하지 않는다. 대상0개는 미판정으로 표시하며, Gradle resolved dependency·실제 JAR/APK·컨테이너 OS·XSS·권한 설계·실서비스 전체 안전을 증명하지 않는다. 그런 대상은 프로젝트별 build/platform 검사와 별도 배포 검토가 필요하다.

raw secret report·diff·author metadata는 artifact나 로그에 올리지 않고 임시 디렉터리에서 삭제한다. 요약은 rule/file/line 및 의존성 대상별 개수만 출력한다. 스캐너 오류·DB 다운로드 실패도 성공으로 처리하지 않는다.

기존 CI의 artifact 발행/배포를 포함한 job은 같은 commit의 reusable security workflow를 needs로 기다린다. 실패/skip이면 publisher가 실행되지 않는다. DB·배포 스크립트 보호 경로를 변경하므로 운영 pull 배포기는 검토대기로 멈출 수 있다. 검토·보존 검증 없이 보호 경로를 비활성화하거나 배포 SHA를 위조하지 않는다. Dependabot은 운영 branch를 향해 주1회 그룹 PR(생태계/경로당 최대2개)을 만들며 자동 병합하지 않는다.
