using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Interfaces;
using Grid;
using Services;
using UnityEngine;

namespace Entities.Player
{
    public class ChainingAbility : BaseAbility
    {
        public readonly List<IBaseEntity> SelectedEntities = new();
        
        public EntitySelectionType AvailableType { get; private set; } = EntitySelectionType.Neutral;
        
        public int TotalDamage { get; private set; }

        public Vector3Int OriginGridPosition => Owner.GridPosition;

        GridService _gridService;
        
        int _killCounter = 0;
            
        int _totalKillToReward = 3;
        
        void Start()
        {
            SelectionState = new ChainingSelectionState(this);
            ExecuteState = new ChainingBaseAttackState(this, Owner);
            _gridService = ServiceLocator.Get<GridService>();
        }

        void Update()
        {
            CheckCanBeExecute();
        }

        public override async UniTask Execute()
        {
            await base.Execute();
            
            StateMachine.SetNextState(ExecuteState);
            
            await UniTask.WaitUntil(() => StateMachine.CurrentState is AbilityIdleState);
            
            _killCounter = 0;
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

                if (entity.Health.IsDead)
                {
                    _killCounter++;
                } 
            }

            if (_killCounter == _totalKillToReward)
            {
                ComboReward();
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

        void ComboReward()
        {
            Debug.Log("Chaining reward");
            var position = _gridService.GetRandomFreeCell();
            
            Debug.Log(position);
        }
        
        void CheckCanBeExecute()
        {
            CanBeExecute = SelectedEntities.Count > 0;
        }
    }
}