using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Grid;
using UnityEngine;

namespace Entities.Player
{
    public class ChainingAbility : BaseAbility
    {
        public readonly List<BaseEntity> SelectedEntities = new();
        
        public EntitySelectionType AvailableType { get; private set; } = EntitySelectionType.Neutral;
        
        public int TotalDamage { get; private set; }

        public Vector3Int OriginGridPosition => Owner.GridPosition;
        
        private void Start()
        {
            InitState = new ChainingSelectionState(this);
        }

        public override async UniTask Execute()
        {
            await base.Execute();
            
            InitState.stateMachine.SetNextState(new ChainingBaseAttackState(this, Owner));

            // Не уверен, что хороший план
            await UniTask.WaitUntil(() => InitState.stateMachine.CurrentState is AbilityIdleState);
        }
        
        public void Attack(Vector3Int direction, int damage)
        {
            var targetPosition = GridService.GridPositionToTileCenter(Owner.GridPosition + direction);
            var hit = Physics2D.OverlapPoint(targetPosition, TilemapLayer);
            
            if (hit == null) return;
            
            var entity = hit.GetComponent<BaseEntity>();
            
            if (entity != null)
            {
                entity.Health.TakeDamage(damage).Forget();
            }
        }

        public void SelectEntity(BaseEntity entity)
        {
            SelectedEntities.Add(entity);

            AvailableType = entity.SelectionType;
        }

        public void RemoveAtIndex(int index)
        {
            if (index < 0) return;

            for (var i = SelectedEntities.Count - 1; i > index; i--)
            {
                SelectedEntities.RemoveAt(i);
            }

            AvailableType = SelectedEntities.Last().SelectionType;
        }

        public void SetTotalDamage(int value)
        {
            TotalDamage = value;
        }
        
        public void ResetSelection()
        {
            SelectedEntities.Clear();
            TotalDamage = 0;
        }
    }
}