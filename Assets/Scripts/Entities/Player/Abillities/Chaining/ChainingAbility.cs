using System.Collections.Generic;
using Core;
using Cysharp.Threading.Tasks;
using Grid;
using UnityEngine;

namespace Entities.Player
{
    public class ChainingAbility : BaseAbility
    {
        public readonly List<BaseEntity> SelectedEntities = new();
        
        private void Start()
        {
            InitState = new ChainingBaseSelectionState(this, _owner);
        }

        public override async UniTask Execute()
        {
            await base.Execute();
            
            InitState.stateMachine.SetNextState(new ChainingBaseAttackState(this, _owner));

            await UniTask.WaitUntil(() => InitState.stateMachine.CurrentState.GetType() == typeof(IdleState));
        }
        
        public void Attack(Vector3Int direction, int damage)
        {
            var targetPosition = GridService.GridPositionToTileCenter(_owner.GridPosition + direction);
            var hit = Physics2D.OverlapPoint(targetPosition, TilemapLayer);
            
            if (hit == null) return;
            
            var entity = hit.GetComponent<BaseEntity>();
            
            if (entity != null)
            {
                entity.Health.TakeDamage(damage).Forget();
            }
        }
    }
}