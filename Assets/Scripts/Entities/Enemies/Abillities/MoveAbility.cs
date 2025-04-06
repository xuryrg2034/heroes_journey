using System;
using System.Collections.Generic;
using Cysharp.Threading.Tasks;
using Grid;
using Services;
using UnityEngine;

namespace Entities.Enemies
{
    [Serializable]
    public class MoveAbility : BaseAbility
    {
        [SerializeField] public LayerMask targetLayer;

        GridService _gridService;


        public override void Initialize(Enemy owner)
        {
            base.Initialize(owner);
            
            _gridService = ServiceLocator.Get<GridService>();
        }

        public override async UniTask Execute()
        {
            if (TryToExecute())
            {
                await Attack();
                Reset();
            }
            else if (State != State.Preparing)
            {
                Prepare();   
            }
        }

        public override void Cancel()
        {
            if (State != State.Preparing) return;

            Reset();
        }

        void Prepare()
        {
            State = State.Preparing;
        }

        async UniTask Attack()
        {
            State = State.Execute;
            
            var tasks = new List<UniTask>();
            var randomCell = _gridService.GetRandomAdjacentCell(Owner.GridPosition);
            
            // Если вдруг так получилось, что нет доступных ячеек
            if (randomCell == Owner.GridPosition) return;

            var tileCenter = GridService.GridPositionToTileCenter(randomCell);
            var hit = Physics2D.OverlapPoint(tileCenter, targetLayer);

            if (hit != null)
            {
                var targetEntity = hit.GetComponent<BaseEntity>();
                var targetMoveTask = targetEntity.Move(Owner.GridPosition);
                tasks.Add(targetMoveTask);
            } 
            
            var ownerMoveTask = Owner.Move(randomCell);
            _drawDebugPoint(tileCenter, Color.red);
            
            tasks.Add(ownerMoveTask);
            
            await UniTask.WhenAll(tasks);
        }

        void Reset()
        {
            _castCounter = 0;
            State = State.Pending;
        }
    }
}