using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Interfaces;
using Grid;
using UnityEngine;

namespace Entities.Player
{
    public class ChainingAbility : BaseAbility
    {
        public readonly List<IBaseEntity> SelectedEntities = new();
        
        public EntitySelectionType AvailableType { get; private set; } = EntitySelectionType.Neutral;
        
        public int TotalDamage { get; private set; }

        public Vector3Int OriginGridPosition => Owner.GridPosition;
        
        void Start()
        {
            SelectionState = new ChainingSelectionState(this);
            ExecuteState = new ChainingBaseAttackState(this, Owner);
        }

        void Update()
        {
            CheckCanBeExecute();
        }

        public override async UniTask Execute()
        {
            IsInProcess = true;

            await base.Execute();
            
            StateMachine.SetNextState(ExecuteState);

            // Не уверен, что хороший план
            await UniTask.WaitUntil(() => StateMachine.CurrentState is AbilityIdleState);
            
            Debug.Log(111);
            IsInProcess = false;
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

        public void SelectEntity(IBaseEntity entity)
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
            AvailableType= EntitySelectionType.Neutral;
            SelectedEntities.Clear();
            TotalDamage = 0;
        }

        void CheckCanBeExecute()
        {
            CanBeExecute = SelectedEntities.Count > 0;
        }
    }
}