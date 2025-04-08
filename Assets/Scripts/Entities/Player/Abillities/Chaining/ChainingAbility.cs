using System.Collections.Generic;
using System.Linq;
using Configs.Entities.Neutral;
using Cysharp.Threading.Tasks;
using Interfaces;
using Grid;
using Services;
using UnityEngine;
using UnityEngine.Serialization;

namespace Entities.Player
{
    public class ChainingAbility : BaseAbility
    {
        [SerializeField] GemConfig rewardConfig;
        
        [SerializeField] int totalKillToReward;
        
        public readonly List<IBaseEntity> SelectedEntities = new();
        
        public EntitySelectionType AvailableType { get; private set; } = EntitySelectionType.Neutral;
        
        public int TotalDamage { get; private set; }

        public Vector3Int OriginGridPosition => Owner.GridPosition;

        GridService _gridService;
        
        SpawnService _spawnService;
        
        int _killCounter = 0;
        
        void Start()
        {
            SelectionState = new ChainingSelectionState(this);
            ExecuteState = new ChainingBaseAttackState(this, Owner);
            _gridService = ServiceLocator.Get<GridService>();
            _spawnService = ServiceLocator.Get<SpawnService>();
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

            if (_killCounter == totalKillToReward)
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
            var excludedPositions = SelectedEntities
                .Where(entity => !entity.Health.IsDead)
                .Select(entity => entity.GridPosition);

            var position = _gridService.GetRandomFreeCell(excludedPositions);
            if (position.HasValue == false) return;
            
            var entityOnGrid = _gridService.GetEntityAt(position.Value);

            if (entityOnGrid)
            {
                _spawnService.DisposeEntity(entityOnGrid);
            }
            
            _spawnService.SpawnGem(position.Value);
            
            Debug.Log(position);
        }
        
        void CheckCanBeExecute()
        {
            CanBeExecute = SelectedEntities.Count > 0;
        }
    }
}