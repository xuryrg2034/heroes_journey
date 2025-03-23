using Cysharp.Threading.Tasks;
using Grid;
using Services;
using Services.EventBus;
using UnityEngine;

namespace Entities.Player
{
    public class ChainingAttackHit : MonoBehaviour
    {
        [SerializeField] private Hero hero;
        
        [SerializeField] private LayerMask targetLayer;
        
        private AbilitiesService _abilitiesService;
        
        // FIXME: интересный костыль, что бы дождаться окончания анимации entity
        // Вероятно удалится после того, как появится аниматор для смерти entity
        private UniTask _entityTakeDamage;

        private void Start()
        {
            _abilitiesService = ServiceLocator.Get<AbilitiesService>();
        }

        public void Attack(Vector3Int direction)
        {
            var ability = (ChainingAttackSelection)_abilitiesService.SelectedAbility;
            var targetPosition = GridService.GridPositionToTileCenter(hero.GridPosition + direction);
            var hit = Physics2D.OverlapPoint(targetPosition, targetLayer);
            
            if (hit == null) return;
            
            var entity = hit.GetComponent<BaseEntity>();
            
            if (entity != null)
            {
                _entityTakeDamage = entity.Health.TakeDamage(ability.Damage);
            }
        }

        public async UniTask End()
        {
            var ability = (ChainingAttackSelection)_abilitiesService.SelectedAbility;
            await _entityTakeDamage;
            ability.AnimationEnd().Forget();
        }

        public void AttackTop()
        {
            Attack(Vector3Int.up);
        }

        public void AttackRight()
        {
            Attack(Vector3Int.right);
        }
        
        public void AttackDown()
        {
            Attack(Vector3Int.down);
        }
        
        public void AttackLeft()
        {
            Attack(Vector3Int.left);
        }
    }
}